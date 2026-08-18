// Built-in defaults and the named preset scenarios, in scenario-code form (short
// keys, whole-percent values) — the same shape produced by "Copy code".
export const BUILTIN = { v: 2, start: 1500000, spend: 70000, ca: 65, ra: 65, ea: 95, ct: 0, fee: 0.2, tx: 0, sm: "fixed", gb: 20, gs: 10, gf: 80, gc: 120, am: "fixed", stk: 60, gsv: 60, gev: 30, smp: "iid", bl: 5, sims: 1000, st: [{ l: "Pension", a: 0, f: "65", t: "", c: 0, b: 0 }] };

export const PRESETS = {
  p_balanced: Object.assign({}, BUILTIN, { st: [] }),
  p_lean: Object.assign({}, BUILTIN, { start: 900000, spend: 40000, stk: 55, st: [] }),
  p_fat: Object.assign({}, BUILTIN, { start: 3000000, spend: 140000, stk: 65, st: [] }),
  p_coast: Object.assign({}, BUILTIN, { ca: 55, ra: 65, ea: 95, start: 500000, spend: 60000, ct: 30000, stk: 75, gsv: 80, gev: 40, am: "glide", st: [{ l: "Social Security", a: 30000, f: "67", t: "", c: 1, b: 0 }] }),
  // Both age bases in one plan: the bridge job is pinned to retirement (b: 1, years
  // 0–4 after it), so sweeping retirement age moves the job with it, while Social
  // Security stays at 67 no matter when you stop working.
  p_bridge: Object.assign({}, BUILTIN, { ca: 55, ra: 60, ea: 95, start: 900000, spend: 70000, ct: 25000, stk: 70, st: [
    { l: "Bridge job", a: 40000, f: "0", t: "4", c: 1, b: 1 },
    { l: "Social Security", a: 30000, f: "67", t: "", c: 1, b: 0 },
  ] }),
};
