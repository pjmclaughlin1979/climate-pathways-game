// Climate scenarios and a light-weight downscaling of them to Irish counties.
//
// Global warming levels (°C above 1850–1900) follow the IPCC AR6 WGI central
// estimates for each SSP. Global mean sea-level rise uses the AR6 median projections,
// re-based to 2020. The national-to-county scaling is an indicative parameterisation
// tuned to reproduce the headline Irish signals reported by:
//   • Met Éireann TRANSLATE (Nolan et al. 2023): Ireland warms more slowly than the global
//     mean, more in the east and midlands; heavy rainfall rises roughly with
//     Clausius–Clapeyron; summers get drier, most of all in the east and south.
//   • EPA Research Report 339 (Nolan & Flanagan 2020): +1–2 °C by mid-century, up to
//     ~20% more heavy precipitation under RCP8.5, and summer rainfall falling by up to
//     ~17–25% by late century.
//   • OPW climate allowances: Mid-Range Future Scenario +20% flood flows; High-End
//     Future Scenario +30% flows and +1.0 m sea level.
// Swap `countyClimate()` for gridded TRANSLATE output for a research-grade version;
// the game engine only depends on its return shape.

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

/**
 * County climate signals for a global state. Every value is a change relative to
 * the present day (2020) unless the name says otherwise.
 */
export function countyClimate(county, region, gwl, gslr, year) {
  const dTpresent = 0.85 * (gwl - G0) * region.tF; // local warming since 2020
  const dT1981 = 0.85 * (gwl - 0.65) * region.tF; // vs the 1981–2010 normal
  const heavyRain = 8 * dTpresent * region.rF; // % change in 1-in-100 rainfall / flows
  const summerRain = -7 * (gwl - G0) * region.dF; // % change in summer rainfall
  const hotRatio = Math.exp(0.55 * dTpresent); // multiple of today's hot days
  const localSlr =
    county.coast > 0 ? 0.9 * gslr + (county.rsl * (year - 2020)) / 1000 : null;
  return {
    dT1981,
    heavyRain,
    summerRain,
    hotDays: region.hot0 * hotRatio,
    hotRatio,
    localSlr,
    // Hazard drivers used by the risk model, keyed by hazard id
    hazards: {
      coastal: localSlr ?? 0,
      fluvial: heavyRain,
      heat: hotRatio,
      water: -summerRain,
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
