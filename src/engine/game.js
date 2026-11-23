// Game state and reducer. Everything is deterministic given the seed, which keeps the
// reducer pure (React StrictMode can run it twice) and makes runs reproducible.
import { COUNTIES, REGIONS, baseEAD } from "../data/counties.js";
import { HAZARDS, HAZARD_IDS, MEASURE_BY_ID } from "../data/measures.js";
import { sampleWorld, observe, signpost, scenarioPlausibility, rand, trueClimate } from "./world.js";
import { portfolioEffect, growthRate, ead, availableMeasures, measureCost } from "./risk.js";
import { runStressTest } from "./stressTest.js";

export const START_YEAR = 2025;
export const END_YEAR = 2100;
export const TURN_YEARS = 5;
export const DISCOUNT = 0.04; // Irish Public Spending Code test discount rate

export const DIFFICULTY = {
  relaxed: { label: "Generous budget", factor: 1.0 },
  standard: { label: "Standard budget", factor: 0.7 },
  tight: { label: "Austerity budget", factor: 0.45 },
};

export const discountFactor = (y) => 1 / (1 + DISCOUNT) ** (y - START_YEAR);

export function initialState() {
  return { phase: "setup" };
}

export function ctxOf(state) {
  const county = COUNTIES[state.countyId];
  return { county, region: REGIONS[county.region], base: state.base };
}

export const ownedIds = (measures) =>
  Object.values(measures)
    .filter((m) => m.status === "building" || m.status === "active")
    .map((m) => m.id);

export const activeIds = (measures) =>
  Object.values(measures)
    .filter((m) => m.status === "active")
    .map((m) => m.id);

/** Why a measure can't be committed right now (or null if it can). */
export function blockReason(state, id, { ignoreFunds = false, forArming = false } = {}) {
  const m = MEASURE_BY_ID[id];
  const cur = state.measures[id];
  if (cur && (cur.status === "building" || cur.status === "active")) return "Already in place";
  const owned = ownedIds(state.measures);
  const armed = Object.values(state.measures).filter((x) => x.status === "armed").map((x) => x.id);
  const ex = m.excludes.find((e) => owned.includes(e));
  if (ex) return `Not compatible with “${MEASURE_BY_ID[ex].name}”`;
  const missing = m.requires.filter((r) => !owned.includes(r) && !(forArming && armed.includes(r)));
  if (missing.length) return `Needs “${MEASURE_BY_ID[missing[0]].name}” first`;
  if (!ignoreFunds && measureCost(m, owned) * state.base[m.hazard] > state.balance + 1e-9)
    return "Not enough budget";
  return null;
}

function commit(state, id, year, mode, events) {
  const m = MEASURE_BY_ID[id];
  const owned = ownedIds(state.measures);
  const cost = measureCost(m, owned) * state.base[m.hazard];
  const reqReady = Math.max(
    0,
    ...m.requires.map((r) => state.measures[r]?.readyYear ?? 0)
  );
  const readyYear = Math.max(year + m.lead, reqReady);
  const prev = state.measures[id];
  state.measures = {
    ...state.measures,
    [id]: {
      id,
      status: readyYear <= year ? "active" : "building",
      mode,
      threshold: prev?.threshold,
      committedYear: year,
      readyYear,
    },
  };
  state.balance -= cost;
  state.totals = {
    ...state.totals,
    capex: state.totals.capex + cost,
    npvCost: state.totals.npvCost + cost * discountFactor(year),
  };
  if (events)
    events.push({
      year,
      kind: mode === "trigger" ? "trigger" : "commit",
      hazard: m.hazard,
      text:
        mode === "trigger"
          ? `Trigger reached: ${m.name} started (€${cost.toFixed(1)}M). Ready in ${readyYear}.`
          : `Committed: ${m.name} (€${cost.toFixed(1)}M). Ready in ${readyYear}.`,
    });
}

function start(action) {
  const { countyId, difficulty, tolerance, seed } = action;
  const county = COUNTIES[countyId];
  const region = REGIONS[county.region];
  const base = baseEAD(county);
  const world = sampleWorld(seed);
  const totalBase = HAZARD_IDS.reduce((s, h) => s + base[h], 0);
  const income = totalBase * DIFFICULTY[difficulty].factor;
  const obs = [];
  for (let y = 2005; y < START_YEAR; y++) obs.push(observe(seed, world, county, region, y));
  return {
    phase: "playing",
    seed,
    countyId,
    difficulty,
    tolerance,
    world,
    base,
    income,
    year: START_YEAR,
    balance: income * 6,
    measures: {},
    exposure: Object.fromEntries(HAZARD_IDS.map((h) => [h, 1])),
    obs,
    history: [],
    events: [],
    lastTurn: null,
    plausibility: scenarioPlausibility(obs, START_YEAR - 1),
    totals: { capex: 0, opex: 0, damages: 0, npvCost: 0, npvDamage: 0 },
    available: availableMeasures(county, base).map((m) => m.id),
  };
}

const SEVERITY = (f) => (f > 6 ? "Extreme" : f > 4.5 ? "Severe" : "Major");

function advance(prev) {
  const s = {
    ...prev,
    measures: { ...prev.measures },
    exposure: { ...prev.exposure },
    obs: [...prev.obs],
    history: [...prev.history],
    events: [...prev.events],
    totals: { ...prev.totals },
  };
  const { county, region, base } = ctxOf(s);
  const turnEvents = [];
  const turnStart = s.year;
  const turnDamage = Object.fromEntries(HAZARD_IDS.map((h) => [h, 0]));
  let turnOpex = 0;

  for (let y = turnStart; y < turnStart + TURN_YEARS; y++) {
    s.balance += s.income;

    // 1. Triggers: compare signposts (observations up to last year) with thresholds.
    for (const m of Object.values(s.measures)) {
      if (m.status !== "armed") continue;
      const def = MEASURE_BY_ID[m.id];
      const sp = signpost(s.obs, def.hazard, y - 1);
      if (sp < m.threshold) continue;
      const reason = blockReason(s, m.id);
      if (!reason) {
        commit(s, m.id, y, "trigger", turnEvents);
      } else if (reason.startsWith("Not compatible")) {
        const { [m.id]: _drop, ...rest } = s.measures;
        s.measures = rest;
        turnEvents.push({ year: y, kind: "warn", hazard: def.hazard, text: `Trigger for ${def.name} cancelled: ${reason}.` });
      } else if (!m.waiting) {
        s.measures[m.id] = { ...m, waiting: true };
        turnEvents.push({
          year: y,
          kind: "warn",
          hazard: def.hazard,
          text: `Trigger reached for ${def.name}, but it can't start: ${reason}. It will start as soon as it can.`,
        });
      }
    }

    // 2. Completions
    for (const m of Object.values(s.measures)) {
      if (m.status === "building" && m.readyYear <= y) {
        s.measures[m.id] = { ...m, status: "active" };
        const def = MEASURE_BY_ID[m.id];
        turnEvents.push({ year: y, kind: "done", hazard: def.hazard, text: `Completed: ${def.name}.` });
      }
    }

    // 3. Climate happens; we observe it.
    s.obs.push(observe(s.seed, s.world, county, region, y));
    const clim = trueClimate(s.world, county, region, y);

    // 4. Risk, damage and running costs
    const act = activeIds(s.measures);
    const row = { year: y, ead: {}, damage: {}, hazard: {} };
    for (const h of HAZARD_IDS) {
      if (!base[h]) continue;
      const eff = portfolioEffect(h, act);
      s.exposure[h] *= 1 + growthRate(h, eff);
      const x = clim.hazards[h];
      const e = ead(base[h], h, x, eff, s.exposure[h], county.id);
      const u = rand(s.seed, "shock", h, y);
      let f = 0.45;
      if (u > 0.85) f = 4.12 * (0.5 + rand(s.seed, "size", h, y));
      const dmg = e * f;
      row.ead[h] = e;
      row.damage[h] = dmg;
      row.hazard[h] = x;
      turnDamage[h] += dmg;
      s.totals.damages += dmg;
      s.totals.npvDamage += dmg * discountFactor(y);
      if (f > 3 && dmg > 0.5 * base[h]) {
        const names = HAZARDS[h].eventNames;
        const name = names[Math.floor(rand(s.seed, "name", h, y) * names.length)];
        turnEvents.push({
          year: y,
          kind: "event",
          hazard: h,
          text: `${SEVERITY(f)} ${name} hits ${county.name}: €${dmg.toFixed(1)}M in damage.`,
        });
      }
    }
    let opex = 0;
    for (const id of act) opex += MEASURE_BY_ID[id].opex * base[MEASURE_BY_ID[id].hazard];
    s.balance -= opex;
    turnOpex += opex;
    s.totals.opex += opex;
    s.totals.npvCost += opex * discountFactor(y);
    row.balance = s.balance;
    s.history.push(row);
  }

  s.year = turnStart + TURN_YEARS;
  const before = prev.plausibility;
  s.plausibility = scenarioPlausibility(s.obs, s.year - 1);
  s.lastTurn = {
    from: turnStart,
    to: s.year,
    events: turnEvents,
    damage: turnDamage,
    opex: turnOpex,
    income: s.income * TURN_YEARS,
    plausibilityBefore: before,
  };
  s.events = [...s.events, ...turnEvents];
  if (s.year >= END_YEAR) {
    s.phase = "ended";
    s.stress = runStressTest(s);
  }
  return s;
}

export function reducer(state, action) {
  switch (action.type) {
    case "start":
      return start(action);
    case "commit": {
      if (state.phase !== "playing" || blockReason(state, action.id)) return state;
      const s = { ...state, totals: { ...state.totals } };
      const ev = [];
      commit(s, action.id, state.year, "now", ev);
      s.events = [...state.events, ...ev];
      return s;
    }
    case "arm": {
      if (state.phase !== "playing") return state;
      const m = MEASURE_BY_ID[action.id];
      return {
        ...state,
        measures: {
          ...state.measures,
          [action.id]: { id: action.id, status: "armed", mode: "trigger", threshold: action.threshold },
        },
        events: [
          ...state.events,
          {
            year: state.year,
            kind: "arm",
            hazard: m.hazard,
            text: `Trigger set: start ${m.name} when the signpost reaches ${HAZARDS[m.hazard].fmt(action.threshold)}.`,
          },
        ],
      };
    }
    case "disarm": {
      const { [action.id]: _x, ...rest } = state.measures;
      return { ...state, measures: rest };
    }
    case "advance":
      return state.phase === "playing" ? advance(state) : state;
    case "dismissTurn":
      return { ...state, lastTurn: null };
    case "reset":
      return initialState();
    default:
      return state;
  }
}
