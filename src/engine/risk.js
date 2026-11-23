// Risk model: portfolio effects, expected annual damage and adaptation tipping points.
import { HAZARDS, MEASURE_BY_ID, MEASURES } from "../data/measures.js";
import { expectedClimate, TRACKS } from "../data/climate.js";
import { floodCurve } from "../data/flood.js";

/** Combined effect of a set of measure ids on one hazard. */
export function portfolioEffect(hazardId, ids) {
  const hz = HAZARDS[hazardId];
  let H = 0;
  let Hadd = 0;
  let mult = 1;
  let stopGrowth = false;
  let hasProtect = false;
  for (const id of ids) {
    const m = MEASURE_BY_ID[id];
    if (!m || m.hazard !== hazardId) continue;
    if (m.H) {
      hasProtect = true;
      H = hz.combine === "sum" ? H + m.H : Math.max(H, m.H);
    }
    Hadd += m.Hadd || 0;
    mult *= m.mult;
    if (m.growth === "stop") stopGrowth = true;
  }
  return { H: H + Hadd, mult, stopGrowth, hasProtect };
}

/** Annual exposure growth rate. Protection without planning control attracts development. */
export function growthRate(hazardId, effect) {
  const hz = HAZARDS[hazardId];
  if (effect.stopGrowth) return 0;
  return effect.hasProtect ? hz.leveeGrowth : hz.growth;
}

/**
 * Damage response for a hazard in a county: risk relative to today at hazard level x with
 * design-standard headroom H. Flood hazards use the county's OPW-derived curve.
 */
export function response(hazardId, countyId, x, H) {
  const curve = countyId ? floodCurve(countyId, hazardId) : null;
  return curve ? curve(x - H) : HAZARDS[hazardId].response(x, H);
}

export function ead(base, hazardId, x, effect, exposure = 1, countyId = null) {
  if (!base) return 0;
  return base * exposure * effect.mult * response(hazardId, countyId, x, effect.H);
}

/**
 * Adaptation tipping point: the hazard level at which EAD exceeds tolerance × base.
 * Returns { x, exceeded } where x may be Infinity (the response never reaches the
 * threshold) and exceeded means the objective is already failed at the minimum
 * hazard level.
 */
export function tippingPoint(hazardId, effect, exposure, tolerance, countyId = null) {
  const hz = HAZARDS[hazardId];
  const f = (x) => exposure * effect.mult * response(hazardId, countyId, x, effect.H) - tolerance;
  let lo = hz.xMin;
  let hi = hz.xMax * 4;
  if (f(lo) >= 0) return { x: lo, exceeded: true };
  if (f(hi) < 0) return { x: Infinity, exceeded: false };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return { x: (lo + hi) / 2, exceeded: false };
}

/** First year a scenario track's expected hazard reaches level x (null if not by 2150). */
export function yearReached(county, region, hazardId, track, x) {
  if (!isFinite(x)) return null;
  for (let y = 2020; y <= 2150; y++) {
    const v = expectedClimate(county, region, track, y).hazards[hazardId];
    if (v >= x) return y;
  }
  return null;
}

/** When the tipping point arrives under each scenario track (DAPP "sell-by dates"). */
export function sellByDates(county, region, hazardId, x) {
  return Object.fromEntries(TRACKS.map((t) => [t, yearReached(county, region, hazardId, t, x)]));
}

/**
 * Fastest plausible rate of change in the hazard driver (per year) near a given level.
 * Used to turn a tipping point into a trigger: trigger = tipping point − lead × rate.
 */
export function fastRate(county, region, hazardId, level) {
  let best = 0;
  for (const t of ["ssp585", "ssp370"]) {
    const y = yearReached(county, region, hazardId, t, level) ?? 2100;
    const y0 = Math.max(2020, Math.min(y, 2100) - 10);
    const a = expectedClimate(county, region, t, y0).hazards[hazardId];
    const b = expectedClimate(county, region, t, y0 + 10).hazards[hazardId];
    best = Math.max(best, (b - a) / 10);
  }
  return best * 1.15;
}

export function suggestTrigger(county, region, hazardId, currentIds, measureId, exposure, tolerance) {
  const m = MEASURE_BY_ID[measureId];
  const tp = tippingPoint(hazardId, portfolioEffect(hazardId, currentIds), exposure, tolerance, county.id);
  const hz = HAZARDS[hazardId];
  if (tp.exceeded) return hz.xMin;
  if (!isFinite(tp.x)) return null;
  const rate = fastRate(county, region, hazardId, tp.x);
  return Math.max(hz.xMin, tp.x - rate * (m.lead + 2));
}

/** Measures that can be played in this county (hazard applies and eligibility holds). */
export function availableMeasures(county, baseEad) {
  return MEASURES.filter((m) => baseEad[m.hazard] > 0 && (!m.eligible || m.eligible(county)));
}

export function measureCost(m, ownedIds) {
  if (m.costIf && m.costIf.any.some((id) => ownedIds.includes(id))) return m.capex * m.costIf.factor;
  return m.capex;
}
