// The scenario codec. The contract worth defending here is compatibility: a code
// someone copied months ago has to keep meaning exactly what it meant then, even
// as fields are added to the format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeScenario, decodeScenario, encodeLadder, decodeLadder } from "../src/config/codec.js";
import { BUILTIN, PRESETS } from "../src/config/presets.js";

const scenario = (over = {}) => ({ ...BUILTIN, ...over });

test("a scenario survives a round trip through the envelope", () => {
  const o = scenario({ start: 900000, spend: 70000, ca: 55, ra: 60, stk: 70 });
  const back = decodeScenario(encodeScenario(o));
  for (const k of ["start", "spend", "ca", "ra", "ea", "stk", "fee", "sm", "am", "smp"]) {
    assert.deepEqual(String(back[k]), String(o[k]), `field ${k}`);
  }
});

test("every built-in preset round-trips", () => {
  for (const [name, o] of Object.entries(PRESETS)) {
    const back = decodeScenario(encodeScenario(o));
    assert.ok(back, `${name} failed to decode`);
    assert.equal(JSON.stringify(back.st), JSON.stringify(o.st), `${name} streams`);
  }
});

test("income streams round-trip with both age bases", () => {
  const st = [
    { l: "Bridge job", a: 40000, f: "-2", t: "4", c: 1, b: 1 },
    { l: "Social Security", a: 30000, f: "67", t: "", c: 1, b: 0 },
  ];
  const back = decodeScenario(encodeScenario(scenario({ st })));
  assert.equal(JSON.stringify(back.st), JSON.stringify(st));
});

test("a negative offset survives the field separator", () => {
  // "-" splits a field's key from its value, so a stream starting two years
  // before retirement is exactly the case that could be torn in half.
  const st = [{ l: "Early-start job", a: 1000, f: "-9", t: "-1", c: 0, b: 1 }];
  const back = decodeScenario(encodeScenario(scenario({ st })));
  assert.equal(back.st[0].f, "-9");
  assert.equal(back.st[0].t, "-1");
  assert.equal(back.st[0].l, "Early-start job");
});

test("a label carrying separator characters survives", () => {
  const st = [{ l: "Rental ~ unit *2 (net) !", a: 1200, f: "65", t: "", c: 0, b: 0 }];
  const back = decodeScenario(encodeScenario(scenario({ st })));
  assert.equal(back.st[0].l, "Rental ~ unit *2 (net) !");
  assert.equal(back.st.length, 1, "structural characters must not split the stream");
});

test("codes written before the basis existed decode as fixed ages", () => {
  // A bare v3 body with the pre-basis five-field stream layout.
  const back = decodeScenario("3~ca-55~st-Social_Security*30000*67**1");
  assert.equal(back.st.length, 1);
  assert.equal(back.st[0].b, 0, "an older code must not become retirement-relative");
  assert.equal(back.st[0].f, "67");
  assert.equal(back.st[0].c, 1);
  assert.equal(back.ca, 55);
});

test("fields the code omits fall back to the frozen baseline", () => {
  const back = decodeScenario("3~ca-55");
  assert.equal(back.ca, 55);
  assert.equal(back.spend, BUILTIN.spend);
  assert.equal(back.ea, BUILTIN.ea);
});

test("the code carries only what differs from the baseline", () => {
  const short = encodeScenario(scenario({ spend: 90000 }));
  const long = encodeScenario(scenario({ spend: 90000, start: 2000000, ca: 40, stk: 90 }));
  assert.ok(short.length < long.length, "a diff against defaults should stay short");
});

test("no streams and one empty stream stay distinguishable", () => {
  const none = decodeScenario(encodeScenario(scenario({ st: [] })));
  const one = decodeScenario(encodeScenario(scenario({ st: [{ l: "", a: 0, f: "", t: "", c: 0, b: 0 }] })));
  assert.equal(none.st.length, 0);
  assert.equal(one.st.length, 1);
});

test("a truncated code is refused rather than half-read", () => {
  const code = encodeScenario(scenario({ start: 900000, spend: 42000 }));
  assert.equal(decodeScenario(code.slice(0, code.length - 6)), null);
});

test("junk decodes to null instead of throwing", () => {
  for (const junk of ["", "   ", "not-a-code", "4", "4!!!!", null, undefined]) {
    assert.doesNotThrow(() => decodeScenario(junk));
  }
});

test("a hostile code cannot spawn unbounded streams or labels", () => {
  const many = Array.from({ length: 40 }, (_, i) => `S${i}*1000`).join("!");
  const wide = "x".repeat(400) + "*1000";
  const a = decodeScenario("3~st-" + many);
  const b = decodeScenario("3~st-" + wide);
  assert.ok(a.st.length <= 12, `stream count capped, got ${a.st.length}`);
  assert.ok(b.st[0].l.length <= 40, `label length capped, got ${b.st[0].l.length}`);
});

test("the scrambled code is base64url-safe", () => {
  const code = encodeScenario(scenario({ start: 1234567, spend: 89000 }));
  assert.match(code, /^4[A-Za-z0-9_-]+$/, "a code must survive a query string untouched");
});

// ---------- The ladder sub-body ----------
// The ladder rides inside one field of the v3 body, so its own grammar has to
// survive that field's escaping — and the field has to be genuinely optional, or
// the feature lengthens every code shared by everyone who never opens the ladder.

const ladder = (over = {}) => ({
  target: 85, maxSpend: 210000,
  tiers: [
    { label: "Bare-bones", anchor: "spend", spend: 42000, age: 65 },
    { label: "Comfortable", anchor: "age", spend: 84000, age: 62 },
  ],
  scenarios: [
    { label: "As planned", on: true, useplan: true, layer: false, streams: [] },
    { label: "Full stop", on: false, useplan: false, layer: false, streams: [
      { label: "Part-time", amount: 35000, from: "4", to: "9", cola: true, basis: "ret" },
    ] },
  ],
  ...over,
});

test("a ladder round-trips inside a scenario code", () => {
  const ld = ladder();
  const back = decodeScenario(encodeScenario(scenario({ ld })));
  assert.deepEqual(back.ld, ld);
});

test("a code without a ladder is not lengthened by the feature", () => {
  // The whole reason the field is written only on demand: someone who never opens
  // the ladder must keep shipping exactly the code they shipped before it existed.
  const plain = encodeScenario(scenario({ start: 900000, spend: 42000 }));
  assert.equal(decodeScenario(plain).ld, undefined, "no ladder field comes back");
  assert.ok(encodeScenario(scenario({ start: 900000, spend: 42000, ld: ladder() })).length > plain.length);
});

test("the ladder token survives the outer grammar untouched", () => {
  // Every separator the outer body uses ("~", "-", "!", "*") and every character
  // encTxt would escape has to be absent from the token, or the field tears in half
  // on the way back out.
  const token = encodeLadder(ladder());
  assert.match(token, /^[A-Za-z0-9.-]+$/);
});

test("a label full of separators cannot tear the ladder apart", () => {
  const nasty = "a|b;c,d!e*f~g_h%i-j.k";
  const ld = ladder({ tiers: [{ label: nasty, anchor: "spend", spend: 1000, age: 60 }] });
  const back = decodeScenario(encodeScenario(scenario({ ld })));
  assert.equal(back.ld.tiers.length, 1);
  assert.equal(back.ld.tiers[0].label, nasty);
});

test("a mangled ladder is dropped, not half-applied", () => {
  for (const junk of ["", "!!!", "Zm9v", "TDF8"]) {
    assert.equal(decodeLadder(junk), null, `${junk} should not decode`);
  }
  // And a scenario carrying one still loads: the ladder is the only casualty.
  const back = decodeScenario("3~spend-42000~ld-Zm9vYmFy");
  assert.equal(back.spend, 42000);
  assert.equal(back.ld, undefined);
});

test("a layered scenario round-trips its mode", () => {
  const ld = ladder({ scenarios: [
    { label: "Plan + side gig", on: true, useplan: false, layer: true, streams: [
      { label: "Consulting", amount: 20000, from: "0", to: "5", cola: false, basis: "ret" },
    ] },
  ] });
  const back = decodeScenario(encodeScenario(scenario({ ld })));
  assert.equal(back.ld.scenarios[0].useplan, false);
  assert.equal(back.ld.scenarios[0].layer, true);
});

test("a ladder token from before the layer mode existed still decodes to its old meaning", () => {
  // Same grammar, minus the trailing ",layer" field — exactly what encodeLadder
  // produced before this field was appended.
  const pre = "L1|85|210000|Bare-bones,0,42000,65|As.planned,1,1,;Full.stop,1,0,";
  const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, ".").replace(/=+$/, "");
  const ld = decodeLadder(b64(pre));
  assert.equal(ld.scenarios[0].useplan, true, "'As planned' still means inherit the plan");
  assert.equal(ld.scenarios[1].useplan, false, "'Full stop' still means replace");
  assert.equal(ld.scenarios[1].layer, false, "a missing layer field defaults to the old 'replace' meaning");
});

test("a hostile ladder cannot spawn unbounded tiers or labels", () => {
  const many = Array.from({ length: 40 }, (_, i) => `T${i},0,1000,60`).join(";");
  const wide = "x".repeat(400) + ",0,1000,60";
  const tok = body => decodeLadder(btoa("L1|85|210000|" + body + "|").replace(/\+/g, "-").replace(/\//g, ".").replace(/=+$/, ""));
  assert.ok(tok(many).tiers.length <= 12, "tier count capped");
  assert.ok(tok(wide).tiers[0].label.length <= 40, "label length capped");
});
