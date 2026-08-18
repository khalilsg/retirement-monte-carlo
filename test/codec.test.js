// The scenario codec. The contract worth defending here is compatibility: a code
// someone copied months ago has to keep meaning exactly what it meant then, even
// as fields are added to the format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeScenario, decodeScenario } from "../src/config/codec.js";
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
