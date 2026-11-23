// Public water supply figures from Uisce Éireann, per county.
//
// uisceWater.json is built by scripts/aggregate_uisce_water.py from the National Water
// Resources Plan (Framework Plan Appendix L, Supply Demand Balance summaries for 535 Water
// Resource Zones) and Uisce Éireann's Water Supply Zone population data. Every figure is for
// the Dry Year Critical Period (DYCP), the planning condition for droughts, in m³/day.
//
// The game uses it to set, per county:
//   • baseline water damage: the 2019 DYCP supply-demand deficit, valued below
//   • growth without new investment: how that deficit grows to 2044 in Uisce Éireann's forecast
//   • damage curve: a drier summer cuts source yields, deepening the deficit
//   • what a leakage programme can recover (real leakage vs a 23% target)
//   • what a strategic transfer can add (Greater Dublin Area counties only)
import UE from "./uisceWater.json" with { type: "json" };

/**
 * Game assumption: unmet demand costs about €2 per m³ (tankering, restrictions, lost business),
 * over an average of 60 critical-period days a year. That gives €120 a year per m³/day of
 * deficit, about €66M a year nationally.
 */
export const EUR_PER_M3 = 2;
export const CRITICAL_DAYS = 60;
const EUR_PER_M3DAY_DEFICIT = EUR_PER_M3 * CRITICAL_DAYS;

/** Leakage target, from Uisce Éireann's North West Regional Water Resources Plan (23% of demand). */
export const LEAKAGE_TARGET = 0.23;

/** Water Supply Project (Shannon to Dublin): 300 Ml/day = 300,000 m³/day for the GDA. */
export const GDA_TRANSFER_M3DAY = 300000;

/** How strongly source yields fall with summer rainfall (game assumption: proportionally). */
const YIELD_SENSITIVITY = 1.0;

export const UE_META = { source: UE.source, units: UE.units, wrzParsed: UE.wrzParsed };

export function ueCounty(countyId) {
  return UE.counties[countyId] ?? null;
}

/** Baseline expected annual water-supply damage, €M/yr (0 if not material, below €0.2M). */
export function waterBase(countyId) {
  const c = UE.counties[countyId];
  if (!c?.dycpDeficit2019) return 0;
  const eur = (c.dycpDeficit2019 * EUR_PER_M3DAY_DEFICIT) / 1e6;
  return eur >= 0.2 ? +eur.toFixed(2) : 0;
}

/** Annual growth of the DYCP deficit 2019→2044 with no new investment (capped at 3%). */
export function waterGrowth(countyId) {
  const c = UE.counties[countyId];
  if (!c?.dycpDeficit2019 || !c?.dycpDeficit2044) return 0.008;
  const g = (c.dycpDeficit2044 / c.dycpDeficit2019) ** (1 / 25) - 1;
  return Math.min(0.03, Math.max(0, g));
}

/** Share of demand a leakage programme frees by cutting leakage to the target, in %. */
export function leakageHeadroom(countyId) {
  const c = UE.counties[countyId];
  if (!c?.demand2019) return 7;
  return Math.max(0, ((c.leakage2019 - LEAKAGE_TARGET * c.demand2019) / c.demand2019) * 100);
}

export function leakageShare(countyId) {
  const c = UE.counties[countyId];
  return c?.demand2019 ? c.leakage2019 / c.demand2019 : null;
}

/** The county's share of a Greater Dublin Area transfer, as % of its deficit zones' demand. */
export function transferHeadroom(countyId) {
  const c = UE.counties[countyId];
  if (!c?.gdaDemandShare || !c.deficitZoneDemand2019) return 0;
  return ((GDA_TRANSFER_M3DAY * c.gdaDemandShare) / c.deficitZoneDemand2019) * 100;
}

export function onGdaSupply(countyId) {
  return (UE.counties[countyId]?.gdaDemandShare ?? 0) > 0.01;
}

/**
 * Water damage response r(x, H): the DYCP deficit relative to today's, when summer rainfall is
 * x% lower than today (yields fall by YIELD_SENSITIVITY × x%) and measures add H% of demand in
 * headroom. Uses the demand (D) and supply (W) of the county's zones that are in deficit.
 */
export function waterResponse(countyId) {
  const c = UE.counties[countyId];
  const D = c?.deficitZoneDemand2019;
  const W = c?.deficitZoneWafu2019;
  if (!D || !W || D <= W) return null;
  return (x, H) => Math.max(0, D * (1 - H / 100) - W * (1 - (YIELD_SENSITIVITY * x) / 100)) / (D - W);
}
