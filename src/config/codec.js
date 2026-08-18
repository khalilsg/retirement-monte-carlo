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
