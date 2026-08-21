// The scenario codec: the shortest string that round-trips a scenario without
// putting anyone's finances on display in a URL.
//
// Two layers. Underneath is the v3 body — plain text carrying only the fields that
// differ from the baseline below, which is what keeps a code short:
//
//   3~ca-55~spend-90000~st-Social_Security*30000*67**1
//   |  |                  |
//   |  |                  income streams, "!"-separated: label*amount*from*to*cola*basis
//   |  one field: <scenario key><KV><value>, "~"-separated
//   body version
//
// One field, "ld", carries the step-up ladder (tiers and comparison scenarios). It
// needs separators of its own two levels deeper than this grammar has, so it rides
// as a self-contained sub-body of its own, base64'd into an alphabet that survives
// the free-text escaper untouched. See "The ladder sub-body" below. It is written
// only once the ladder has actually been edited, so a code from anyone who ignores
// the ladder is exactly as short as it was before the feature existed.
//
// Over the top goes the v4 envelope (see "Obfuscation" below), which is what
// actually ships: the same scenario as "4NmpXbUFuS0hDWndqSg…". Only base64url
// characters come out, so a code survives a query string, a hash, a chat window,
// or a paste box untouched.
//
// v1/v2 codes (base64'd JSON) and bare v3 bodies both still decode.
import { SCENARIO_FIELDS } from "./parameters.js";

const V = "3";
const REC = "~";   // between fields
const KV = "-";    // between a field's key and value (split at the first one, so a
                   // negative number or a hyphenated stream label stays intact)
const SL = "!";    // between income streams
const SF = "*";    // between one stream's fields

// A hostile link shouldn't be able to spawn a thousand income streams or a label
// wide enough to break the layout.
const MAX_STREAMS = 12, MAX_LABEL = 40;

// The baseline a code is a diff against. It is a snapshot of the built-in defaults,
// deliberately *frozen and separate* from BUILTIN: if a built-in default ever
// changes, every code already shared must keep meaning what it meant when it was
// copied, so change BUILTIN freely and leave this alone. Keys absent here (a tunable
// added later) are simply always written out, which is the right behavior — an older
// code that predates the field just leaves it at its HTML default.
const BASE = Object.freeze({
  start: 1500000, spend: 70000, ca: 65, ra: 65, ea: 95, ct: 0, fee: 0.2, tx: 0,
  sm: "fixed", gb: 20, gs: 10, gf: 80, gc: 120, am: "fixed", stk: 60, gsv: 60, gev: 30,
  smp: "iid", bl: 5, sims: 1000, st: [{ l: "Pension", a: 0, f: "65", t: "", c: 0, b: 0 }],
});

const FIELD_BY_KEY = {};
for (const e of SCENARIO_FIELDS) FIELD_BY_KEY[e.scen] = e;

// ---------- Free text (stream labels) ----------
// Percent-escape everything encodeURIComponent would leave that we use structurally,
// then spend one character on a space — by far the most common label character after
// the letters themselves.
const encTxt = s => encodeURIComponent(String(s)).replace(/[!'()*~_]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "_");
const decTxt = s => { try { return decodeURIComponent(String(s).replace(/_/g, "%20")); } catch (e) { return String(s); } };

// ---------- Values ----------
const num = v => { const n = +v; return isFinite(n) ? String(n) : "0"; };
// Select values ride as their index in the entry's `opts` list, so "guardrails"
// costs one character. Anything unrecognized falls back to the literal value.
function encField(e, v) {
  if (e.opts) { const i = e.opts.indexOf(String(v)); if (i >= 0) return String(i); }
  return e.repr === "select" ? encTxt(v) : num(v);
}
function decField(e, raw) {
  if (e.opts && /^\d+$/.test(raw) && e.opts[+raw] != null) return e.opts[+raw];
  if (e.repr === "select") return decTxt(raw);
  const n = +raw;
  return isFinite(n) && raw !== "" ? n : BASE[e.scen];
}
// Scenario values are numbers or select strings; compare loosely so 60 and "60" match.
const same = (a, b) => b !== undefined && String(a) === String(b);

// ---------- Income streams ----------
// `b` is the age basis: 0 = fixed ages, 1 = years relative to retirement. It rides
// last so every code written before it existed decodes to 0, which is what those
// codes meant.
function encStreams(list) {
  return (list || []).map(s => {
    const f = [encTxt(s.l == null ? "" : s.l), num(s.a), String(s.f == null ? "" : s.f), String(s.t == null ? "" : s.t), s.c ? "1" : "0", s.b ? "1" : "0"];
    // Trailing empties and zeros are what the decoder assumes anyway. Two fields are
    // always kept so a blank stream still encodes as something ("*0"), which is what
    // separates "one empty stream" from "no streams at all".
    while (f.length > 2 && (f[f.length - 1] === "" || f[f.length - 1] === "0")) f.pop();
    return f.join(SF);
  }).join(SL);
}
function decStreams(raw) {
  if (raw === "") return [];
  return raw.split(SL).slice(0, MAX_STREAMS).map(part => {
    const f = part.split(SF);
    return {
      l: decTxt(f[0] || "").slice(0, MAX_LABEL),
      a: +f[1] || 0,
      f: String(f[2] || ""),
      t: String(f[3] || ""),
      c: f[4] === "1" ? 1 : 0,
      b: f[5] === "1" ? 1 : 0,
    };
  });
}

// ---------- The ladder sub-body ----------
// A ladder is a list of tiers and a list of named scenarios, and a scenario carries
// a stream list — three levels of nesting under the field value, where the v3 body
// affords none. So it gets its own grammar with its own separators and is then
// base64'd, which flattens the whole thing back to one opaque token.
//
// The token's alphabet is the point: base64url with "." standing in for "_", so the
// characters that come out are exactly [A-Za-z0-9-.] — none of which encTxt escapes
// and none of which "_" decoding turns back into a space. The token therefore
// passes through the outer grammar as an ordinary value, unescaped and unexpanded.
//
//   L1|<target>|<maxSpend>|<tier>;<tier>|<scenario>;<scenario>
//     tier      = label,anchor(0 spend / 1 age),spend,age
//     scenario  = label,on,useplan,<stream>!<stream>
//     stream    = label*amount*from*to*cola*basis   (as above)
//
// Labels go through encTxt, which escapes everything outside [A-Za-z0-9-.] — every
// separator here included — so no label can tear the grammar apart.
const LV = "L1";
const L0 = "|", L1 = ";", L2 = ",";

const MAX_TIERS = 12, MAX_VARIANTS = 6;

const b64d = bytes => btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, ".").replace(/=+$/, "");
function unb64d(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/\./g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A ladder object is { target, maxSpend, tiers: [...], scenarios: [...] }, in the
// same shape ui/ladder.js holds it.
export function encodeLadder(L) {
  if (!L || !Array.isArray(L.tiers) || !Array.isArray(L.scenarios)) return "";
  const tiers = L.tiers.map(t => [encTxt(t.label == null ? "" : t.label), t.anchor === "age" ? "1" : "0", num(t.spend), num(t.age)].join(L2)).join(L1);
  const scen = L.scenarios.map(v => [
    encTxt(v.label == null ? "" : v.label), v.on ? "1" : "0", v.useplan ? "1" : "0", encStreams((v.streams || []).map(s => ({ l: s.label, a: s.amount, f: s.from, t: s.to, c: s.cola ? 1 : 0, b: s.basis === "ret" ? 1 : 0 }))),
  ].join(L2)).join(L1);
  const body = [LV, num(L.target), num(L.maxSpend), tiers, scen].join(L0);
  try { return b64d(new TextEncoder().encode(body)); } catch (e) { return ""; }
}

export function decodeLadder(token) {
  let body = "";
  try { body = new TextDecoder().decode(unb64d(String(token))); } catch (e) { return null; }
  const parts = body.split(L0);
  // A token that lost its tail can still begin "L1|85|21", which would decode to a
  // plausible-looking ladder with no rungs in it. Both the version and the full
  // section count have to be there.
  if (parts[0] !== LV || parts.length < 5) return null;
  const tiers = (parts[3] || "").split(L1).filter(Boolean).slice(0, MAX_TIERS).map(rec => {
    const f = rec.split(L2);
    return { label: decTxt(f[0] || "").slice(0, MAX_LABEL), anchor: f[1] === "1" ? "age" : "spend", spend: +f[2] || 0, age: +f[3] || 0 };
  });
  const scenarios = (parts[4] || "").split(L1).filter(Boolean).slice(0, MAX_VARIANTS).map(rec => {
    const f = rec.split(L2);
    return {
      label: decTxt(f[0] || "").slice(0, MAX_LABEL),
      on: f[1] === "1",
      useplan: f[2] === "1",
      streams: decStreams(f[3] || "").map(s => ({ label: s.l, amount: s.a, from: s.f, to: s.t, cola: !!s.c, basis: s.b ? "ret" : "age" })),
    };
  });
  if (!tiers.length) return null;
  return { target: +parts[1] || 0, maxSpend: +parts[2] || 0, tiers, scenarios };
}

// ---------- The v3 body ----------
function encodeBody(o) {
  if (!o) return "";
  const parts = [V];
  for (const e of SCENARIO_FIELDS) {
    const v = o[e.scen];
    if (v == null || same(v, BASE[e.scen])) continue;
    parts.push(e.scen + KV + encField(e, v));
  }
  if (Array.isArray(o.st)) {
    const st = encStreams(o.st);
    if (st !== encStreams(BASE.st)) parts.push("st" + KV + st);
  }
  // No baseline to diff against: the ladder's own defaults are derived from the
  // plan's spending rather than fixed, so the field is present exactly when the
  // caller decided there was a ladder worth carrying.
  if (o.ld) { const ld = encodeLadder(o.ld); if (ld) parts.push("ld" + KV + ld); }
  return parts.join(REC);
}

// Start from the baseline and lay the code's fields over it; anything the code
// omitted was, by definition, the default.
function decodeV3(s) {
  const o = Object.assign({}, BASE, { v: 3, st: BASE.st.map(x => Object.assign({}, x)) });
  for (const rec of s.split(REC).slice(1)) {
    const i = rec.indexOf(KV);
    if (i < 0) continue;
    const k = rec.slice(0, i), raw = rec.slice(i + 1);
    if (k === "st") { o.st = decStreams(raw); continue; }
    // A ladder that fails to decode is dropped rather than half-applied: an absent
    // ladder is a state the UI already handles (it seeds one), a mangled one isn't.
    if (k === "ld") { const ld = decodeLadder(raw); if (ld) o.ld = ld; continue; }
    const e = FIELD_BY_KEY[k];
    if (e) o[k] = decField(e, raw);   // unknown keys: a newer code read by an older build
  }
  return o;
}

// v1/v2: base64url of the scenario JSON. Read-only — nothing writes these anymore.
function decodeLegacy(s) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  } catch (e) { return null; }
}

// ---------- The v4 envelope: obfuscation ----------
// A body like "3~spend-40000~start-900000" reads someone's finances off the address
// bar to anyone standing behind them, so it goes out XOR'd against a keystream and
// re-encoded in base64url.
//
// This is obfuscation, not encryption, and the difference matters: the keystream is
// generated by the function directly below, in a public repo, so anyone who wants
// the numbers back can have them in a minute. What it buys is that a link in a chat
// window, a browser history, or a screen share doesn't *display* the numbers. Don't
// treat a scenario link as private — everyone you send it to sees the scenario.
const MARK = "4";

// xorshift32, seeded from the payload length. Length-seeding costs nothing and means
// a truncated code — the usual way a link dies in transit — unscrambles to noise that
// fails the body check below, rather than to a plausible-looking wrong scenario.
function keystream(seed) {
  let x = (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 255; };
}
// Symmetric: the seed depends only on the length, which XOR preserves.
function scramble(bytes) {
  const next = keystream(bytes.length), out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ next();
  return out;
}

const b64 = bytes => btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function unb64(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeScenario(o) {
  const body = encodeBody(o);
  if (!body) return "";
  try { return MARK + b64(scramble(new TextEncoder().encode(body))); } catch (e) { return body; }
}

export function decodeScenario(code) {
  const s = String(code == null ? "" : code).trim();
  if (!s) return null;
  if (/^3($|~)/.test(s)) return decodeV3(s);              // a bare body, hand-written or from a debug session
  if (s[0] === MARK) {
    let body = "";
    try { body = new TextDecoder().decode(scramble(unb64(s.slice(1)))); } catch (e) { return null; }
    return /^3($|~)/.test(body) ? decodeV3(body) : null;  // anything else came back mangled
  }
  return decodeLegacy(s);
}
