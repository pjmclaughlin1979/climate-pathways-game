import { COUNTY_LIST, COUNTIES, REGIONS, baseEAD } from "../data/counties.js";
import { HAZARDS, HAZARD_IDS } from "../data/measures.js";
import { DIFFICULTY } from "../engine/game.js";

export const TOLERANCES = [
  { v: 1.0, label: "No worse than today (1.0×)" },
  { v: 1.25, label: "Up to 1.25× today's expected damage" },
  { v: 1.5, label: "Up to 1.5× today's expected damage" },
  { v: 2.0, label: "Up to 2× today's expected damage" },
];

export default function SetupPanel({ setup, setSetup, onStart, onAbout }) {
  const county = COUNTIES[setup.countyId];
  const base = county ? baseEAD(county) : null;
  return (
    <div className="panel-scroll setup">
      <h2>Plan for a future you can't predict</h2>
      <p className="lead">
        You lead climate adaptation for an Irish county from <b>2025 to 2100</b>. Every five years you
        decide what to build now, what to prepare behind a <b>trigger</b>, and which signposts to watch.
        You won't be told which climate future is unfolding. You'll only see the evidence as it builds up.
      </p>

      <label className="field">
        <span>1 · Choose your county (or click it on the map)</span>
        <select value={setup.countyId ?? ""} onChange={(e) => setSetup({ ...setup, countyId: e.target.value })}>
          <option value="" disabled>
            Select a county…
          </option>
          {[...COUNTY_LIST]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>

      {county && (
        <div className="county-card">
          <div className="county-head">
            <h3>{county.name}</h3>
            <span className="muted">
              {REGIONS[county.region].label} · {county.pop.toLocaleString("en-IE")} people
            </span>
          </div>
          <p>{county.note}</p>
          <div className="hazard-grid">
            {HAZARD_IDS.map((h) => (
              <div key={h} className={`hz-chip ${base[h] ? "" : "off"}`}>
                <span>{HAZARDS[h].icon}</span>
                <span>{HAZARDS[h].label}</span>
                <b>{base[h] ? `€${base[h].toFixed(1)}M/yr` : "n/a"}</b>
              </div>
            ))}
          </div>
          <p className="muted small">Expected annual damage today, with today's defences.</p>
        </div>
      )}

      <div className="field">
        <span>2 · Budget</span>
        <div className="seg">
          {Object.entries(DIFFICULTY).map(([k, d]) => (
            <button
              key={k}
              className={setup.difficulty === k ? "on" : ""}
              onClick={() => setSetup({ ...setup, difficulty: k })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>3 · Your risk objective (sets each plan's tipping point)</span>
        <select value={setup.tolerance} onChange={(e) => setSetup({ ...setup, tolerance: Number(e.target.value) })}>
          {TOLERANCES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <button className="primary big" disabled={!county} onClick={onStart}>
        Start planning in 2025 →
      </button>
      <button className="link" onClick={onAbout}>
        How dynamic adaptive policy pathways work, and where the data comes from
      </button>

      <div className="concepts">
        <Concept t="Adaptation tipping point">
          The level of climate change at which a plan stops meeting your objective. It's a hazard
          level, not a date.
        </Concept>
        <Concept t="Sell-by date">
          When a tipping point arrives depends on the scenario. You'll see a date for each future.
        </Concept>
        <Concept t="Signposts and triggers">
          Watch the observed signals. Arm the next action to start automatically when a signpost
          crosses a trigger value. Set the trigger early enough to allow for the action's lead time.
        </Concept>
        <Concept t="Lock-in and flexibility">
          Fixed designs are cheaper now but expensive to change later. Adaptive designs cost more now
          and keep your options open.
        </Concept>
      </div>
    </div>
  );
}

function Concept({ t, children }) {
  return (
    <div className="concept">
      <b>{t}</b>
      <p>{children}</p>
    </div>
  );
}
