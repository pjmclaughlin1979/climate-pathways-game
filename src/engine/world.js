// The hidden "true world" and what the player is allowed to observe of it.
import {
  SCENARIOS,
  SCENARIO_WEIGHTS,
  ICE_PROBABILITY,
  TRACKS,
  gwlAt,
  globalSlrAt,
  countyClimate,
} from "../data/climate.js";
import { HAZARDS, HAZARD_IDS } from "../data/measures.js";

/** Deterministic hash-based random number in [0, 1), so reducers stay pure. */
export function rand(seed, ...keys) {
  let h = 2166136261 ^ seed;
  for (const k of keys) {
    const s = String(k);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    h = Math.imul(h ^ 0x9e3779b9, 2246822507);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function randn(seed, ...keys) {
  const u = Math.max(1e-9, rand(seed, ...keys, "a"));
  const v = rand(seed, ...keys, "b");
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleWorld(seed) {
  let u = rand(seed, "scenario");
  let scenarioId = SCENARIOS[SCENARIOS.length - 1].id;
  for (const s of SCENARIOS) {
    u -= SCENARIO_WEIGHTS[s.id];
    if (u < 0) {
      scenarioId = s.id;
      break;
    }
  }
  const sensitivity = Math.min(1.35, Math.max(0.7, 1 + 0.15 * randn(seed, "sens")));
  // Ice-sheet instability is only plausible in the warmer worlds.
  const ice = scenarioId !== "ssp126" && rand(seed, "ice") < ICE_PROBABILITY * (scenarioId === "ssp585" ? 2 : 1);
  // Where Ireland's regional response sits in the TRANSLATE model spread:
  // 0 = ensemble mean, ±1 = 90th / 10th percentile.
  const regional = Math.min(1, Math.max(-1, 0.5 * randn(seed, "regional")));
  return { scenarioId, sensitivity, ice, regional };
}

export function trueGlobal(world, year) {
  return {
    gwl: gwlAt(world.scenarioId, year, world.sensitivity),
    gslr: globalSlrAt(world.scenarioId, year, world.sensitivity, world.ice),
  };
}

export function trueClimate(world, county, region, year) {
  const g = trueGlobal(world, year);
  return countyClimate(county, region, g.gwl, g.gslr, year, world.regional);
}

/** One year of noisy observations: natural variability on top of the forced signal. */
export function observe(seed, world, county, region, year) {
  const g = trueGlobal(world, year);
  const c = countyClimate(county, region, g.gwl, g.gslr, year, world.regional);
  const hazards = {};
  for (const h of HAZARD_IDS) {
    let v = c.hazards[h] + HAZARDS[h].noise * randn(seed, "obs", h, year);
    if (h === "heat") v = Math.max(0.3, v);
    hazards[h] = v;
  }
  if (county.coast === 0) hazards.coastal = 0;
  return {
    year,
    gwl: g.gwl + 0.08 * randn(seed, "obs-gwl", year),
    gslr: g.gslr + 0.01 * randn(seed, "obs-gslr", year),
    hazards,
  };
}

/** Signpost = 5-year running mean of observations up to and including `year`. */
export function signpost(obs, key, year, window = 5) {
  const pick = obs.filter((o) => o.year <= year && o.year > year - window);
  if (!pick.length) return 0;
  const get = (o) => (key === "gwl" || key === "gslr" ? o[key] : o.hazards[key]);
  return pick.reduce((s, o) => s + get(o), 0) / pick.length;
}

const PRIOR = { ssp126: 0.22, ssp245: 0.22, ssp370: 0.22, ssp585: 0.22, highend: 0.12 };

function npdf(x, m, sd) {
  return Math.exp(-0.5 * ((x - m) / sd) ** 2) / sd;
}

/**
 * How well each scenario track explains the evidence so far. This is a likelihood
 * weighting of the signposts, not a forecast probability.
 */
export function scenarioPlausibility(obs, year) {
  if (year < 2026) return { ...PRIOR };
  const g = signpost(obs, "gwl", year);
  const s = signpost(obs, "gslr", year);
  const w = {};
  let tot = 0;
  for (const t of TRACKS) {
    const mg = gwlAt(t, year);
    const ms = globalSlrAt(t, year);
    const sdg = Math.sqrt(0.045 ** 2 + (0.15 * (mg - 1.2)) ** 2);
    const sds = Math.sqrt(0.006 ** 2 + (0.15 * ms) ** 2);
    w[t] = PRIOR[t] * npdf(g, mg, sdg) * npdf(s, ms, sds);
    tot += w[t];
  }
  for (const t of TRACKS) w[t] = tot > 0 ? w[t] / tot : PRIOR[t];
  return w;
}
