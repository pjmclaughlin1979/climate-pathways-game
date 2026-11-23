// Flood exposure from OPW flood maps, per county.
//
// opwExposure.json is built by scripts/aggregate_opw_exposure.py. It overlays OPW flood
// extents (National Coastal Flood Hazard Mapping 2021; CFRAM community-scale and NIFM river
// maps) on Census 2022 Small Area population. For each county, scenario and flood probability
// it gives the people living inside the flood extent, and `ead`: the expected number of people
// flooded per year, integrated over probability.
//
// The game uses it in two ways:
//   1. Baseline flood damage = expected people flooded per year (today) × EUR_PER_PERSON_FLOODED,
//      calibrated so national river-flood damage matches the Central Bank of Ireland's
//      modelled average annual cost of inland flooding.
//   2. Each county's damage curve: how expected annual exposure grows from the OPW current
//      scenario to its future scenarios (+0.5, +1.0, +1.5, +2.0 m sea level; +20%, +30% river
//      flows), times a depth factor (the extent maps show where floods reach, not how much
//      deeper they get). Defences shift the hazard back along that curve by their standard.
import OPW from "./opwExposure.json" with { type: "json" };

/**
 * Calibration anchor: the Central Bank of Ireland's Flood Protection Gap report (October 2024)
 * estimates the average annual cost of inland (river and surface-water) flooding at about
 * €101m. Spreading Small Area population evenly over each area overcounts the people inside
 * flood extents, so the € value per expected person flooded is fitted to that national total
 * rather than assumed. Coastal flooding (which the Central Bank excludes) uses the same rate.
 */
export const NATIONAL_INLAND_FLOOD_COST = 101e6;
export const EUR_PER_PERSON_FLOODED = NATIONAL_INLAND_FLOOD_COST / OPW.national.fluvial.c;

// Below this baseline (€M/yr) a flood hazard is treated as not material for the county
// (e.g. Tipperary's small tidal reach of the Suir).
const MIN_BASE = 0.2;

export const OPW_META = { source: OPW.source, method: OPW.method, scenarios: OPW.scenarios };

export function opwCounty(countyId) {
  return OPW.counties[countyId] ?? null;
}

/** Baseline expected annual flood damage today, €M/yr, for "coastal" or "fluvial". */
export function floodBase(countyId, hazard) {
  const c = OPW.counties[countyId];
  const ead = c?.[hazard]?.c?.ead ?? 0;
  const eur = (ead * EUR_PER_PERSON_FLOODED) / 1e6;
  return eur >= MIN_BASE ? +eur.toFixed(2) : 0;
}

const MIN_DEFENCE_SLOPE = { coastal: Math.LN10 / 0.5, fluvial: Math.LN10 / 30 };

/**
 * Depth factor (game assumption): damage per person flooded rises roughly linearly with flood
 * depth. Coastal: +100% per 0.5 m of sea-level rise, taking today's typical flood depth as about
 * half a metre. River: +50% per 30% increase in peak flows.
 */
export const DEPTH_SCALE = { coastal: 0.5, fluvial: 60 };

const curveCache = new Map();

/**
 * County damage curve r(x): expected annual exposure at hazard level x relative to today
 * (r(0) = 1), interpolated log-linearly between OPW scenarios, times the depth factor. Beyond
 * the mapped range it extends the nearest segment's slope, so a defence (negative x) cuts risk
 * exponentially.
 * Returns null if the county has no exposure to this hazard.
 */
export function floodCurve(countyId, hazard) {
  const key = `${countyId}|${hazard}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const c = OPW.counties[countyId]?.[hazard];
  const scen = OPW.scenarios[hazard];
  let fn = null;
  if (c && c.c?.ead > 0) {
    const pts = Object.entries(scen)
      .map(([k, x]) => [x, Math.log(Math.max(c[k]?.ead ?? 0, c.c.ead * 1e-3) / c.c.ead)])
      .sort((a, b) => a[0] - b[0]);
    // Exposure can't fall as the hazard rises: enforce a monotone curve.
    for (let i = 1; i < pts.length; i++) pts[i][1] = Math.max(pts[i][1], pts[i - 1][1]);
    const slope = (i) => (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]);
    const n = pts.length - 1;
    // Below today's level (a defence's headroom), risk falls with the number of floods the
    // defence keeps out, which extent maps can't show. Never let it fall more slowly than a
    // tenfold cut per 0.5 m (coastal) or per 30% of flow (river).
    const below = Math.max(slope(0), MIN_DEFENCE_SLOPE[hazard]);
    fn = (x) => {
      let y;
      if (x <= pts[0][0]) y = pts[0][1] + below * (x - pts[0][0]);
      else if (x >= pts[n][0]) y = pts[n][1] + slope(n - 1) * (x - pts[n][0]);
      else {
        let i = 0;
        while (x > pts[i + 1][0]) i++;
        y = pts[i][1] + slope(i) * (x - pts[i][0]);
      }
      return Math.exp(y) * (x > 0 ? 1 + x / DEPTH_SCALE[hazard] : 1);
    };
  }
  curveCache.set(key, fn);
  return fn;
}
