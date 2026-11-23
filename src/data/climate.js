// Climate scenarios, and Met Éireann TRANSLATE projections for each Irish county.
//
// Global warming levels (GWL, °C above 1850–1900) follow the IPCC AR6 WGI central
// estimates for each SSP. Global mean sea-level rise uses the AR6 median projections,
// re-based to 2020 (TRANSLATE does not cover sea level).
//
// County signals come from Met Éireann's TRANSLATE projections (CMIP5 regional-model
// ensemble, O'Brien & Nolan 2023), published at https://www.climateservices.ie/TRANSLATE/
// as 1.5 km grids at warming levels of 1.5, 2, 2.5, 3 and 4 °C, relative to 1976–2005.
// scripts/aggregate_translate.py averages each grid over each county into
// translateCounties.json: annual mean temperature, summer (JJA) rainfall, the wettest
// day of the year (Rx1day) and summer days (Tmax > 25 °C), each as the ensemble mean
// and the 10th and 90th percentiles. This file interpolates those values to any GWL.
//
// The OPW climate allowances (Mid-Range Future Scenario +20% flood flows; High-End
// Future Scenario +30% flows and +1.0 m sea level) set the game's design standards.
import TRANSLATE from "./translateCounties.json" with { type: "json" };
import { deficitIndex } from "./water.js";

export const SCENARIOS = [
  {
    id: "ssp126",
    short: "1-2.6",
    label: "SSP1-2.6",
    name: "Paris-aligned",
    color: "#2a9d8f",
    gwl: [1.2, 1.5, 1.6, 1.7, 1.8, 1.8, 1.8, 1.8, 1.8],
    slr: [0.13, 0.38],
  },
  {
    id: "ssp245",
    short: "2-4.5",
    label: "SSP2-4.5",
    name: "Middle of the road",
    color: "#e9c46a",
    gwl: [1.2, 1.5, 1.8, 2.0, 2.2, 2.4, 2.5, 2.6, 2.7],
    slr: [0.14, 0.5],
  },
  {
    id: "ssp370",
    short: "3-7.0",
    label: "SSP3-7.0",
    name: "Regional rivalry",
    color: "#f4a261",
    gwl: [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.3, 3.6],
    slr: [0.16, 0.62],
  },
  {
    id: "ssp585",
    short: "5-8.5",
    label: "SSP5-8.5",
    name: "Fossil-fuelled",
    color: "#e76f51",
    gwl: [1.2, 1.6, 1.9, 2.4, 2.8, 3.2, 3.6, 4.0, 4.4],
    slr: [0.17, 0.71],
  },
];

// Low-likelihood, high-impact ice-sheet track (AR6 "cannot be ruled out" range).
export const HIGH_END = {
  id: "highend",
    short: "High-end",
  label: "SSP5-8.5 + ice sheets",
  name: "Low-likelihood, high-impact",
  color: "#9b2226",
};

export const SCENARIO_BY_ID = Object.fromEntries(
  [...SCENARIOS, HIGH_END].map((s) => [s.id, s])
);

// Hidden-world sampling weights. The player is never told these: they plan under
// deep uncertainty and see only the evidence that accumulates.
export const SCENARIO_WEIGHTS = { ssp126: 0.15, ssp245: 0.4, ssp370: 0.3, ssp585: 0.15 };
export const ICE_PROBABILITY = 0.12;

const YEARS = [2020, 2030, 2040, 2050, 2060, 2070, 2080, 2090, 2100];

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0] + ((ys[1] - ys[0]) / (xs[1] - xs[0])) * (x - xs[0]);
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  const n = xs.length - 1;
  return ys[n] + ((ys[n] - ys[n - 1]) / (xs[n] - xs[n - 1])) * (x - xs[n]);
}

const G0 = 1.2; // warming in 2020

/** Global warming level in a given year. `s` scales the response (climate sensitivity). */
export function gwlAt(scenarioId, year, s = 1) {
  const sc = SCENARIO_BY_ID[scenarioId === "highend" ? "ssp585" : scenarioId];
  // Historical: about +0.25 °C per decade before 2020.
  if (year < 2020) return G0 - 0.025 * (2020 - year);
  const v = interp(YEARS, sc.gwl, year);
  return G0 + (v - G0) * s;
}

/** Global mean sea-level rise since 2020, in metres. */
export function globalSlrAt(scenarioId, year, s = 1, ice = false) {
  const isHigh = scenarioId === "highend";
  const sc = SCENARIO_BY_ID[isHigh ? "ssp585" : scenarioId];
  if (year < 2020) return -0.0037 * (2020 - year);
  const [s50, s100] = sc.slr;
  const b = (s100 - (80 / 30) * s50) / 4000;
  const a = (s50 - 900 * b) / 30;
  const dt = year - 2020;
  let v = (a * dt + b * dt * dt) * s;
  if ((ice || isHigh) && year > 2050) v += 0.9 * ((year - 2050) / 50) ** 2;
  return v;
}

// Global warming level of TRANSLATE's 1976–2005 baseline period (above 1850–1900).
const BASELINE_GWL = 0.5;
const ANCHORS = [BASELINE_GWL, ...TRANSLATE.gwls];

/**
 * A TRANSLATE variable for a county at warming level `gwl`, as change from 1976–2005.
 * Linear between warming levels, extrapolated beyond 4 °C along the 3→4 °C slope.
 * `q` picks a point in the model spread: 0 = ensemble mean, +1 = 90th percentile,
 * −1 = 10th percentile.
 */
export function translateValue(countyId, variable, gwl, q = 0) {
  const v = TRANSLATE.vars[variable].values[countyId];
  const pick = (i) => {
    const m = v.mean[i];
    return q >= 0 ? m + q * (v.p90[i] - m) : m + q * (m - v.p10[i]);
  };
  const ys = [0, ...TRANSLATE.gwls.map((_, i) => pick(i))];
  return interp(ANCHORS, ys, Math.max(gwl, BASELINE_GWL));
}

export const TRANSLATE_META = {
  source: TRANSLATE.source,
  baselinePeriod: TRANSLATE.baselinePeriod,
  gwls: TRANSLATE.gwls,
  cells: TRANSLATE.cells,
};

const pctFromPresent = (v, v0) => ((1 + v / 100) / (1 + v0 / 100) - 1) * 100;

/**
 * County climate for a global state. `q` is the regional-response percentile (see
 * translateValue). Hazard drivers are changes from the present day (2020); the
 * *vs1976* values are TRANSLATE's own change from its 1976–2005 baseline.
 */
export function countyClimate(county, region, gwl, gslr, year, q = 0) {
  const id = county.id;
  const T = (v, g) => translateValue(id, v, g, q);
  const rx = T("rx1day", gwl);
  const jja = T("summerRain", gwl);
  const su0 = TRANSLATE.baselineSummerDays[id];
  const hotDays = Math.max(0, su0 + T("summerDays", gwl));
  const hotDaysNow = Math.max(0.5, su0 + T("summerDays", G0));
  const heavyRain = pctFromPresent(rx, T("rx1day", G0));
  const summerRain = pctFromPresent(jja, T("summerRain", G0));
  const localSlr =
    county.coastal ? 0.9 * gslr + (county.rsl * (year - 2020)) / 1000 : null;
  return {
    dT1976: T("tmean", gwl),
    rx1dayVs1976: rx,
    summerRainVs1976: jja,
    heavyRain,
    summerRain,
    hotDays,
    hotRatio: hotDays / hotDaysNow,
    localSlr,
    dryness: -summerRain,
    // Hazard drivers used by the risk model, keyed by hazard id
    hazards: {
      coastal: localSlr ?? 0,
      fluvial: heavyRain,
      heat: hotDays / hotDaysNow,
      water: deficitIndex(id, -summerRain, year),
    },
  };
}

/** Expected (noise-free) climate for a scenario track. */
export function expectedClimate(county, region, scenarioId, year) {
  return countyClimate(
    county,
    region,
    gwlAt(scenarioId, year),
    globalSlrAt(scenarioId, year),
    year
  );
}

export const TRACKS = [...SCENARIOS.map((s) => s.id), "highend"];
