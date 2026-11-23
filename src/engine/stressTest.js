// End-of-game stress test: replay a plan (its fixed commitments and its triggers)
// against every scenario track with expected, noise-free climate, and compare it with
// benchmark strategies. This is how DAPP judges a plan: by robustness across futures,
// not by how well it did in the one future that happened.
import { COUNTIES, REGIONS } from "../data/counties.js";
import { HAZARD_IDS, MEASURE_BY_ID, EXPERT_PLAN, STATIC_PLAN } from "../data/measures.js";
import { TRACKS, expectedClimate } from "../data/climate.js";
import { portfolioEffect, growthRate, ead, measureCost, suggestTrigger } from "./risk.js";

const START = 2025;
const END = 2100;
const df = (y) => 1 / 1.04 ** (y - START);

export function simulatePlan(county, region, base, plan, track) {
  const state = {}; // id -> { readyYear }
  const exposure = Object.fromEntries(HAZARD_IDS.map((h) => [h, 1]));
  let npvCost = 0;
  let npvDamage = 0;
  const owned = () => Object.keys(state);
  const canStart = (m) =>
    !state[m.id] &&
    m.requires.every((r) => state[r]) &&
    !m.excludes.some((e) => state[e]);
  const doCommit = (m, y) => {
    const ready = Math.max(y + m.lead, ...m.requires.map((r) => state[r].readyYear));
    const cost = measureCost(m, owned()) * base[m.hazard];
    state[m.id] = { readyYear: ready };
    npvCost += cost * df(y);
  };
  const nows = plan.filter((p) => p.mode === "now").sort((a, b) => a.year - b.year);
  const trig = plan.filter((p) => p.mode === "trigger");

  for (let y = START; y < END; y++) {
    for (const p of nows) {
      const m = MEASURE_BY_ID[p.id];
      if (p.year <= y && canStart(m)) doCommit(m, y);
    }
    for (const p of trig) {
      const m = MEASURE_BY_ID[p.id];
      const sp = expectedClimate(county, region, track, y - 1).hazards[m.hazard];
      if (sp >= p.threshold && canStart(m)) doCommit(m, y);
    }
    const act = Object.entries(state)
      .filter(([, v]) => v.readyYear <= y)
      .map(([id]) => id);
    const clim = expectedClimate(county, region, track, y);
    for (const h of HAZARD_IDS) {
      if (!base[h]) continue;
      const eff = portfolioEffect(h, act);
      exposure[h] *= 1 + growthRate(h, eff);
      npvDamage += ead(base[h], h, clim.hazards[h], eff, exposure[h]) * df(y);
    }
    for (const id of act) npvCost += MEASURE_BY_ID[id].opex * base[MEASURE_BY_ID[id].hazard] * df(y);
  }
  return { npvCost, npvDamage, total: npvCost + npvDamage };
}

export function planFromState(s) {
  return Object.values(s.measures).map((m) =>
    m.mode === "trigger"
      ? { id: m.id, mode: "trigger", threshold: m.threshold }
      : { id: m.id, mode: "now", year: m.committedYear }
  );
}

export function expertPlan(county, region, base, tolerance, available) {
  const plan = [];
  for (const h of HAZARD_IDS) {
    if (!base[h]) continue;
    const ids = [...EXPERT_PLAN[h].now.filter((id) => available.includes(id))];
    ids.forEach((id) => plan.push({ id, mode: "now", year: START }));
    for (const id of EXPERT_PLAN[h].seq) {
      if (!available.includes(id)) continue;
      const t = suggestTrigger(county, region, h, ids, id, 1, tolerance);
      if (t == null) break;
      plan.push({ id, mode: "trigger", threshold: t });
      ids.push(id);
    }
  }
  return plan;
}

export function staticPlan(base, available) {
  return HAZARD_IDS.filter((h) => base[h]).flatMap((h) =>
    STATIC_PLAN[h].filter((id) => available.includes(id)).map((id) => ({ id, mode: "now", year: START }))
  );
}

export const STRATEGIES = [
  { id: "yours", label: "Your plan", color: "#1d3557" },
  { id: "expert", label: "Adaptive pathway (benchmark)", color: "#277da1" },
  { id: "static", label: "Build high-end now", color: "#bc6c25" },
  { id: "none", label: "Do nothing", color: "#9a9a9a" },
];

export function runStressTest(s) {
  const county = COUNTIES[s.countyId];
  const region = REGIONS[county.region];
  const plans = {
    yours: planFromState(s),
    expert: expertPlan(county, region, s.base, s.tolerance, s.available),
    static: staticPlan(s.base, s.available),
    none: [],
  };
  const results = {};
  for (const t of TRACKS) {
    results[t] = {};
    for (const [k, p] of Object.entries(plans)) results[t][k] = simulatePlan(county, region, s.base, p, t);
  }
  const regret = {};
  for (const k of Object.keys(plans)) {
    regret[k] = Math.max(
      ...TRACKS.map((t) => results[t][k].total - Math.min(...Object.values(results[t]).map((r) => r.total)))
    );
  }
  return { results, regret, plans };
}
