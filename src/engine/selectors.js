// Derived views of the game state used by the UI.
import { HAZARDS, MEASURE_BY_ID } from "../data/measures.js";
import { expectedClimate, TRACKS } from "../data/climate.js";
import { COUNTIES, REGIONS, baseEAD } from "../data/counties.js";
import { signpost } from "./world.js";
import { portfolioEffect, ead, tippingPoint, sellByDates, suggestTrigger, measureCost } from "./risk.js";
import { ownedIds, activeIds, ctxOf } from "./game.js";

export function hazardStatus(state, h) {
  const { county, region, base } = ctxOf(state);
  const sp = signpost(state.obs, h, state.year - 1);
  const act = activeIds(state.measures);
  const own = ownedIds(state.measures);
  const effNow = portfolioEffect(h, act);
  const effOwned = portfolioEffect(h, own);
  const E = state.exposure[h];
  const eadNow = ead(base[h], h, Math.max(HAZARDS[h].xMin, sp), effNow, E);
  const tpNow = tippingPoint(h, effNow, E, state.tolerance);
  const tpOwned = tippingPoint(h, effOwned, E, state.tolerance);
  return {
    signpost: sp,
    eadNow,
    riskRatio: base[h] ? eadNow / base[h] : 0,
    tpNow,
    tpOwned,
    sellBy: sellByDates(county, region, h, tpOwned.x),
    exposure: E,
    leveeWarning: effOwned.hasProtect && !effOwned.stopGrowth,
    activeCount: act.filter((id) => MEASURE_BY_ID[id].hazard === h).length,
  };
}

/** Tipping point if a candidate measure were added to what is already committed. */
export function tpWith(state, h, id) {
  const own = ownedIds(state.measures);
  const ids = [...own, id, ...MEASURE_BY_ID[id].requires];
  return tippingPoint(h, portfolioEffect(h, ids), state.exposure[h], state.tolerance);
}

export function suggestedTrigger(state, id) {
  const { county, region } = ctxOf(state);
  const m = MEASURE_BY_ID[id];
  const own = ownedIds(state.measures);
  // Plan the trigger off everything committed or already armed earlier in the pathway.
  const armedBefore = Object.values(state.measures)
    .filter((x) => x.status === "armed" && x.id !== id && MEASURE_BY_ID[x.id].hazard === m.hazard)
    .map((x) => x.id);
  return suggestTrigger(county, region, m.hazard, [...own, ...armedBefore], id, state.exposure[m.hazard], state.tolerance);
}

export function costOf(state, id) {
  const m = MEASURE_BY_ID[id];
  return measureCost(m, ownedIds(state.measures)) * state.base[m.hazard];
}

/** Expected hazard trajectory for each scenario track (for fan charts). */
export function trajectories(countyId, h, from = 2005, to = 2100, step = 1) {
  const county = COUNTIES[countyId];
  const region = REGIONS[county.region];
  const out = {};
  for (const t of TRACKS) {
    out[t] = [];
    for (let y = from; y <= to; y += step) out[t].push([y, expectedClimate(county, region, t, y).hazards[h]]);
  }
  return out;
}

// ── Map variables ──────────────────────────────────────────────────────────────

export const MAP_VARIABLES = {
  risk: {
    label: "Unadapted climate risk (× today's expected damage)",
    short: "Unadapted risk",
    breaks: [1, 1.25, 1.5, 2, 3, 5, 10, 1e9],
    colors: ["#fff5eb", "#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#e6550d", "#a63603"],
    fmt: (v) => `${v.toFixed(1)}×`,
  },
  dT1981: {
    label: "Mean temperature change vs 1981–2010 (°C)",
    short: "Temperature",
    breaks: [0, 0.75, 1, 1.25, 1.5, 2, 2.5, 9],
    colors: ["#fff7bc", "#fee391", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#8c2d04"],
    fmt: (v) => `+${v.toFixed(1)} °C`,
  },
  heavyRain: {
    label: "Change in extreme rainfall vs today (%)",
    short: "Extreme rainfall",
    breaks: [-99, 2.5, 5, 10, 15, 20, 25, 999],
    colors: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
    fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`,
  },
  summerRain: {
    label: "Change in summer rainfall vs today (%)",
    short: "Summer rainfall",
    breaks: [-999, -25, -20, -15, -10, -5, -2.5, 99],
    colors: ["#8c510a", "#bf812d", "#dfc27d", "#f0dca8", "#f6e8c3", "#faf3e0", "#f5f5f5"],
    fmt: (v) => `${v.toFixed(0)}%`,
  },
  hotDays: {
    label: "Hot days above 25 °C per year",
    short: "Hot days",
    breaks: [0, 3, 6, 10, 15, 25, 40, 999],
    colors: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#de2d26", "#a50f15"],
    fmt: (v) => `${v.toFixed(0)} days`,
  },
  localSlr: {
    label: "Relative sea-level rise since 2020 (m)",
    short: "Sea level",
    breaks: [-1, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 9],
    colors: ["#edf8fb", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#6e016b"],
    fmt: (v) => `+${v.toFixed(2)} m`,
  },
};

export function mapValue(countyId, variable, track, year) {
  const county = COUNTIES[countyId];
  if (!county) return null;
  const region = REGIONS[county.region];
  const c = expectedClimate(county, region, track, year);
  if (variable === "risk") {
    const b = baseEAD(county);
    let tot = 0;
    let now = 0;
    const eff = { H: 0, mult: 1 };
    for (const h of Object.keys(b)) {
      if (!b[h]) continue;
      now += b[h];
      tot += ead(b[h], h, Math.max(HAZARDS[h].xMin, c.hazards[h]), eff, 1);
    }
    return now ? tot / now : null;
  }
  return c[variable];
}

export { TRACKS };
