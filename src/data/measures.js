// Hazards and the adaptation measures that can be put on a pathway.
//
// The risk model for each hazard is
//   EAD = baseEAD × exposure × Π(multipliers) × response(hazard − headroom)
// where `headroom` is a design standard (e.g. defences raised by +0.5 m). A measure or
// portfolio reaches its ADAPTATION TIPPING POINT when EAD rises past the player's risk
// objective (a multiple of today's EAD). The tipping point is a hazard level, not a
// date: the scenario you end up in decides when you reach it.
//
// Costs are multiples of the hazard's baseline EAD, so the economics hold for any county.
//   capex  – one-off cost, paid when the measure is committed
//   opex   – annual running cost once active
//   lead   – years from commitment to full effect
//   H      – design-standard headroom. Hazards with combine "max" take the highest
//            standard among active measures; "sum" hazards add them.
//   Hadd   – headroom always added on top (nature-based, demand-side measures)
//   mult   – multiplier on damages (warnings, property protection, relocation)
//   growth – "stop" halts exposure growth (planning controls)
//   requires / excludes – path dependencies between measures
//   tags   – noRegret | adaptive | lockIn | transformative | nature | planning

import { onGdaSupply, leakageHeadroom } from "./water.js";

export const HAZARDS = {
  coastal: {
    id: "coastal",
    label: "Coastal flooding",
    icon: "🌊",
    driver: "Relative sea-level rise",
    unit: "m",
    combine: "max",
    xMin: 0,
    xMax: 1.8,
    growth: 0.01,
    leveeGrowth: 0.02,
    noise: 0.012,
    response: (x, H) => 10 ** ((x - H) / 0.5),
    fmt: (v) => `${v.toFixed(2)} m`,
    eventNames: ["storm surge", "spring-tide surge", "Atlantic storm"],
  },
  fluvial: {
    id: "fluvial",
    label: "River & surface-water flooding",
    icon: "🌧️",
    driver: "Change in wettest-day rainfall since today",
    unit: "%",
    combine: "max",
    xMin: 0,
    xMax: 30,
    growth: 0.01,
    leveeGrowth: 0.02,
    noise: 3.5,
    response: (x, H) => 10 ** ((x - H) / 30),
    fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`,
    eventNames: ["river flood", "flash flood", "winter flood"],
  },
  heat: {
    id: "heat",
    label: "Heat stress",
    icon: "🌡️",
    driver: "Summer days (>25 °C) as a multiple of today",
    unit: "×",
    combine: "max",
    xMin: 1,
    xMax: 6,
    growth: 0.008,
    leveeGrowth: 0.008,
    noise: 0.2,
    response: (x, H) => x / (1 + H),
    fmt: (v) => `${v.toFixed(1)}×`,
    eventNames: ["heatwave"],
  },
  water: {
    id: "water",
    label: "Drought & water supply",
    icon: "💧",
    driver: "Supply–demand deficit vs today, before new measures",
    unit: "×",
    combine: "sum",
    xMin: 0,
    xMax: 4,
    // Demand growth is already in the deficit index, so exposure doesn't grow separately.
    growth: 0,
    leveeGrowth: 0,
    noise: 5, // % of summer rainfall; observations pass it through the deficit index
    response: (x, H) => Math.max(0, x - H / 25),
    fmt: (v) => `${v.toFixed(2)}×`,
    eventNames: ["summer drought", "hosepipe-ban summer"],
  },
};

export const HAZARD_IDS = Object.keys(HAZARDS);

const M = (o) => ({ H: 0, Hadd: 0, mult: 1, opex: 0, requires: [], excludes: [], tags: [], ...o });

export const MEASURES = [
  // ── Coastal ────────────────────────────────────────────────────────────────
  M({
    id: "c_warn", hazard: "coastal", name: "Coastal flood forecasting & warning",
    desc: "Real-time surge forecasts and community alerts so property and people can be moved out of harm's way.",
    capex: 1, opex: 0.03, lead: 2, mult: 0.85, tags: ["noRegret"],
  }),
  M({
    id: "c_plan", hazard: "coastal", name: "Coastal setback & flood-zone planning",
    desc: "Stops new homes and assets being built in coastal flood zones, so exposure stops growing. Cheap, but it doesn't lower today's risk.",
    capex: 0.5, opex: 0.01, lead: 1, growth: "stop", tags: ["noRegret", "planning"],
  }),
  M({
    id: "c_dunes", hazard: "coastal", name: "Dune & saltmarsh restoration",
    desc: "Nature-based buffer that damps waves and adds about 0.15 m of effective protection on top of any defences.",
    capex: 4, opex: 0.08, lead: 5, Hadd: 0.15, tags: ["nature", "noRegret"],
  }),
  M({
    id: "c_wall", hazard: "coastal", name: "Raise sea defences +0.5 m (fixed design)",
    desc: "Conventional quay walls and embankments built to a +0.5 m standard. Cheaper now, but going higher later means rebuilding from the foundations.",
    capex: 14, opex: 0.1, lead: 10, H: 0.5, excludes: ["c_wall_adapt"], tags: ["lockIn"],
  }),
  M({
    id: "c_wall_adapt", hazard: "coastal", name: "Adaptable sea defences +0.5 m (foundations for +1.2 m)",
    desc: "Built to +0.5 m today, with foundations and a footprint sized so they can be raised later. Costs about 30% more now and buys cheap flexibility.",
    capex: 18, opex: 0.1, lead: 10, H: 0.5, excludes: ["c_wall"], tags: ["adaptive"],
  }),
  M({
    id: "c_wall_up_fixed", hazard: "coastal", name: "Rebuild fixed defences to +1.0 m",
    desc: "Demolish and rebuild the fixed-design defences to a higher standard.",
    capex: 16, opex: 0.12, lead: 12, H: 1.0, requires: ["c_wall"], tags: ["lockIn"],
  }),
  M({
    id: "c_wall_up_adapt", hazard: "coastal", name: "Raise adaptable defences to +1.2 m",
    desc: "Add height to the adaptable defences. Fast and cheap because the foundations already exist.",
    capex: 5, opex: 0.12, lead: 5, H: 1.2, requires: ["c_wall_adapt"], tags: ["adaptive"],
  }),
  M({
    id: "c_barrier", hazard: "coastal", name: "Tidal storm-surge barrier (+1.6 m)",
    desc: "Transformative engineering: a moveable estuary barrier. Very high protection, a long lead time and heavy running costs.",
    capex: 45, opex: 0.6, lead: 20, H: 1.6, tags: ["transformative", "lockIn"],
  }),
  M({
    id: "c_retreat", hazard: "coastal", name: "Managed realignment & planned relocation",
    desc: "Moves the most exposed homes and assets inland and gives space back to the sea, cutting exposure by about 65%. Costs 30% more once hard defences have locked development in.",
    capex: 22, lead: 15, mult: 0.35, tags: ["transformative"],
    costIf: { any: ["c_wall", "c_wall_adapt", "c_barrier"], factor: 1.3 },
  }),

  // ── River & surface-water flooding ─────────────────────────────────────────
  M({
    id: "f_warn", hazard: "fluvial", name: "Flood forecasting & warning",
    desc: "Catchment flood forecasts linked to local emergency response.",
    capex: 0.8, opex: 0.03, lead: 2, mult: 0.8, tags: ["noRegret"],
  }),
  M({
    id: "f_plan", hazard: "fluvial", name: "Floodplain development restrictions",
    desc: "Strict sequential-test planning so no new exposure is added to the floodplain.",
    capex: 0.4, opex: 0.01, lead: 1, growth: "stop", tags: ["noRegret", "planning"],
  }),
  M({
    id: "f_plp", hazard: "fluvial", name: "Individual property protection scheme",
    desc: "Grants for flood doors, non-return valves and resilient fit-outs. A quick win, but it only trims damages.",
    capex: 2, lead: 3, mult: 0.75, tags: ["noRegret"],
  }),
  M({
    id: "f_nfm", hazard: "fluvial", name: "Natural flood management (catchment)",
    desc: "Upland storage, rewetted bogs, leaky dams and riparian planting that shave peak flows by about 6%.",
    capex: 4, opex: 0.05, lead: 10, Hadd: 6, tags: ["nature", "noRegret"],
  }),
  M({
    id: "f_suds", hazard: "fluvial", name: "Sponge-town SuDS retrofit",
    desc: "Rain gardens, permeable streets and attenuation that cut surface-water peaks by about 5%.",
    capex: 5, opex: 0.05, lead: 8, Hadd: 5, tags: ["nature"],
  }),
  M({
    id: "f_frs", hazard: "fluvial", name: "Flood relief scheme to MRFS (+20% flows), fixed",
    desc: "Walls and embankments designed for the OPW Mid-Range Future Scenario. Cheapest way to the +20% standard.",
    capex: 14, opex: 0.1, lead: 10, H: 20, excludes: ["f_frs_adapt"], tags: ["lockIn"],
  }),
  M({
    id: "f_frs_adapt", hazard: "fluvial", name: "Adaptable flood relief scheme (MRFS now, HEFS-ready)",
    desc: "Built to MRFS (+20%) with structures sized to be raised to the High-End Future Scenario (+30%) later.",
    capex: 17, opex: 0.1, lead: 10, H: 20, excludes: ["f_frs"], tags: ["adaptive"],
  }),
  M({
    id: "f_frs_up_fixed", hazard: "fluvial", name: "Rebuild scheme to HEFS (+30% flows)",
    desc: "Replace the fixed scheme with one built to the high-end standard.",
    capex: 15, opex: 0.12, lead: 10, H: 30, requires: ["f_frs"], tags: ["lockIn"],
  }),
  M({
    id: "f_frs_up_adapt", hazard: "fluvial", name: "Upgrade adaptable scheme to HEFS (+30%)",
    desc: "Raise the adaptable scheme to the high-end standard, using the capacity built in from the start.",
    capex: 4, opex: 0.12, lead: 4, H: 30, requires: ["f_frs_adapt"], tags: ["adaptive"],
  }),
  M({
    id: "f_relocate", hazard: "fluvial", name: "Voluntary relocation from highest-risk homes",
    desc: "Buy-out and relocation of the most frequently flooded properties, cutting damages by about 45%.",
    capex: 12, lead: 10, mult: 0.55, tags: ["transformative"],
    costIf: { any: ["f_frs", "f_frs_adapt"], factor: 1.3 },
  }),

  // ── Heat ───────────────────────────────────────────────────────────────────
  M({
    id: "h_warn", hazard: "heat", name: "Heat-health action plan & warnings",
    desc: "Heat alerts, check-ins on vulnerable people, and cooling centres.",
    capex: 0.5, opex: 0.03, lead: 1, mult: 0.75, tags: ["noRegret"],
  }),
  M({
    id: "h_regs", hazard: "heat", name: "Overheating standards for new buildings",
    desc: "Building regulations that design out overheating, so exposure stops growing.",
    capex: 0.5, opex: 0.01, lead: 2, growth: "stop", tags: ["noRegret", "planning"],
  }),
  M({
    id: "h_green", hazard: "heat", name: "Urban tree canopy & green infrastructure",
    desc: "Shade and evaporative cooling. Slow to mature, with large co-benefits.",
    capex: 4, opex: 0.06, lead: 12, mult: 0.8, tags: ["nature"],
  }),
  M({
    id: "h_retro", hazard: "heat", name: "Cooling retrofit: hospitals, care homes, schools",
    desc: "Passive and active cooling for the most vulnerable settings.",
    capex: 9, opex: 0.08, lead: 6, mult: 0.55, tags: [],
  }),

  // ── Water supply ───────────────────────────────────────────────────────────
  M({
    id: "w_drought", hazard: "water", name: "Drought management plans",
    desc: "Pre-agreed drought triggers, restrictions and emergency supply arrangements.",
    capex: 0.5, opex: 0.02, lead: 1, mult: 0.8, tags: ["noRegret"],
  }),
  M({
    id: "w_meter", hazard: "water", name: "Metering & water conservation",
    desc: "Demand management worth about 4% of summer supply-demand headroom.",
    capex: 3, opex: 0.05, lead: 4, H: 4, tags: ["noRegret"],
  }),
  M({
    id: "w_leak", hazard: "water", name: "Leakage reduction programme",
    desc: "Mains rehabilitation and pressure management that cut leakage to Uisce Éireann's 23% target. The headroom it frees depends on this county's actual leakage.",
    capex: 6, opex: 0.08, lead: 6, H: 7, tags: ["noRegret"],
    eligible: (c) => leakageHeadroom(c.id) >= 1,
  }),
  M({
    id: "w_storage", hazard: "water", name: "New regional raw-water storage",
    desc: "New reservoir or storage capacity adding about 15% headroom.",
    capex: 18, opex: 0.15, lead: 15, H: 15, tags: ["lockIn"],
  }),
  M({
    id: "w_transfer", hazard: "water", name: "Strategic inter-regional water transfer",
    desc: "A long-distance pipeline from the Shannon (like the Water Supply Project, 300,000 m³/day for the Greater Dublin Area). Only for counties on the Greater Dublin supply.",
    capex: 30, opex: 0.3, lead: 18, H: 25, tags: ["transformative", "lockIn"],
    eligible: (c) => onGdaSupply(c.id),
  }),
  M({
    id: "w_desal", hazard: "water", name: "Desalination plant",
    desc: "A climate-independent supply adding about 20% headroom. Quick to build, but energy-hungry and expensive to run. Coastal counties only.",
    capex: 14, opex: 0.6, lead: 7, H: 20, tags: [],
    eligible: (c) => c.coastal,
  }),
];

export const MEASURE_BY_ID = Object.fromEntries(MEASURES.map((m) => [m.id, m]));

export const TAG_INFO = {
  noRegret: { label: "No-regret", color: "#2a9d8f", tip: "Pays off in every scenario" },
  adaptive: { label: "Adaptive design", color: "#277da1", tip: "Built so it can be upgraded cheaply later" },
  lockIn: { label: "Lock-in risk", color: "#bc6c25", tip: "Hard and costly to change course afterwards" },
  transformative: { label: "Transformative", color: "#6a4c93", tip: "Changes the system itself, with long lead times" },
  nature: { label: "Nature-based", color: "#588157", tip: "Ecosystem-based, with co-benefits" },
  planning: { label: "Planning", color: "#6c757d", tip: "Stops exposure from growing" },
};

// The "expert" adaptive plan used as a benchmark in the end-of-game stress test.
// No-regret measures now; then a sequence of adaptive measures, each armed with a
// trigger set at (tipping point − lead time × plausible fast rate of change).
export const EXPERT_PLAN = {
  coastal: { now: ["c_warn", "c_plan", "c_dunes"], seq: ["c_wall_adapt", "c_wall_up_adapt"] },
  fluvial: { now: ["f_warn", "f_plan", "f_nfm"], seq: ["f_frs_adapt", "f_frs_up_adapt"] },
  heat: { now: ["h_warn", "h_regs"], seq: ["h_green", "h_retro"] },
  water: { now: ["w_drought", "w_meter"], seq: ["w_leak", "w_storage"] },
};

// "Predict and provide": build to the high-end standard straight away.
export const STATIC_PLAN = {
  coastal: ["c_wall", "c_wall_up_fixed"],
  fluvial: ["f_frs", "f_frs_up_fixed"],
  heat: ["h_retro", "h_green"],
  water: ["w_leak", "w_storage"],
};
