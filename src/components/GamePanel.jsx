import { useState } from "react";
import { HAZARDS, MEASURE_BY_ID, TAG_INFO } from "../data/measures.js";
import { SCENARIO_BY_ID, TRACKS } from "../data/climate.js";
import { blockReason } from "../engine/game.js";
import { tpWith, suggestedTrigger, costOf } from "../engine/selectors.js";
import { SignpostChart, PathwaysMap, Bar, shortName } from "./Charts.jsx";

const TABS = [
  { id: "plan", label: "Plan" },
  { id: "monitor", label: "Monitor" },
  { id: "pathways", label: "Pathways map" },
  { id: "log", label: "Log" },
];

export default function GamePanel({ state, statuses, hazards, dispatch }) {
  const [tab, setTab] = useState("plan");
  const [hazard, setHazard] = useState(hazards[0]);
  const st = statuses[hazard];

  return (
    <div className="game-panel">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab !== "log" && (
        <div className="hazard-pills">
          {hazards.map((h) => {
            const s = statuses[h];
            const level = riskLevel(s, state.tolerance);
            return (
              <button key={h} className={`pill ${hazard === h ? "on" : ""}`} onClick={() => setHazard(h)}>
                <span className={`dot ${level}`} />
                {HAZARDS[h].icon} {HAZARDS[h].label.split(" ")[0]}
              </button>
            );
          })}
        </div>
      )}
      <div className="panel-scroll">
        {tab === "plan" && <PlanTab state={state} hazard={hazard} st={st} dispatch={dispatch} />}
        {tab === "monitor" && <MonitorTab state={state} hazard={hazard} st={st} />}
        {tab === "pathways" && <PathwaysTab state={state} hazard={hazard} st={st} />}
        {tab === "log" && <LogTab state={state} />}
      </div>
    </div>
  );
}

export function riskLevel(s, tol) {
  if (!s) return "ok";
  if (s.riskRatio > tol) return "bad";
  if (s.riskRatio > tol * 0.8) return "warn";
  return "ok";
}

function HazardSummary({ state, hazard, st }) {
  const hz = HAZARDS[hazard];
  const tol = state.tolerance;
  const level = riskLevel(st, tol);
  return (
    <section className="summary">
      <div className="summary-row">
        <div>
          <div className="k">Signpost: {hz.driver.toLowerCase()}</div>
          <div className="v">{hz.fmt(st.signpost)}</div>
          <div className="muted small">5-year running mean of observations</div>
        </div>
        <div>
          <div className="k">Expected damage now</div>
          <div className={`v ${level}`}>€{st.eadNow.toFixed(1)}M/yr</div>
          <div className="muted small">
            {st.riskRatio.toFixed(2)}× today's (objective ≤ {tol}×)
          </div>
        </div>
      </div>
      <Bar value={st.riskRatio} max={Math.max(tol * 2, st.riskRatio)} marker={tol} color={level === "bad" ? "#c0392b" : level === "warn" ? "#e09f3e" : "#2a9d8f"} />
      <div className="tp-box">
        <div>
          <span className="k">Tipping point of your committed plan </span>
          <b>{st.tpOwned.exceeded ? "already passed" : isFinite(st.tpOwned.x) ? hz.fmt(st.tpOwned.x) : "beyond range"}</b>
        </div>
        <div className="sellby">
          <span className="k">Sell-by date under each future:</span>
          <div className="sellby-row">
            {TRACKS.map((t) => (
              <span key={t} className="sb" style={{ borderColor: SCENARIO_BY_ID[t].color }} title={SCENARIO_BY_ID[t].name}>
                <i style={{ background: SCENARIO_BY_ID[t].color }} />
                {SCENARIO_BY_ID[t].short}: <b>{st.tpOwned.exceeded ? "now" : st.sellBy[t] ?? ">2150"}</b>
              </span>
            ))}
          </div>
        </div>
        {st.leveeWarning && (
          <p className="warn-note">
            ⚠ Levee effect: protection without planning controls is attracting new development, so
            exposure is growing at 2% a year (now {st.exposure.toFixed(2)}× its 2025 level).
          </p>
        )}
      </div>
    </section>
  );
}

function PlanTab({ state, hazard, st, dispatch }) {
  const ids = state.available.filter((id) => MEASURE_BY_ID[id].hazard === hazard);
  const order = { active: 0, building: 1, armed: 2 };
  ids.sort((a, b) => (order[state.measures[a]?.status] ?? 3) - (order[state.measures[b]?.status] ?? 3));
  return (
    <>
      <HazardSummary state={state} hazard={hazard} st={st} />
      <h4 className="section-title">Measures</h4>
      {ids.map((id) => (
        <MeasureCard key={id} state={state} id={id} dispatch={dispatch} />
      ))}
    </>
  );
}

function effectText(m) {
  const hz = HAZARDS[m.hazard];
  const parts = [];
  if (m.H) parts.push(hz.combine === "sum" ? `+${m.H}${hz.unit} supply headroom` : `Design standard ${hz.fmt(m.H)}`);
  if (m.Hadd) parts.push(`+${hz.unit === "m" ? m.Hadd.toFixed(2) + " m" : m.Hadd + hz.unit} headroom`);
  if (m.mult < 1) parts.push(`−${Math.round((1 - m.mult) * 100)}% damages`);
  if (m.growth === "stop") parts.push("Stops exposure growth");
  return parts.join(" · ");
}

function MeasureCard({ state, id, dispatch }) {
  const m = MEASURE_BY_ID[id];
  const hz = HAZARDS[m.hazard];
  const cur = state.measures[id];
  const cost = costOf(state, id);
  const reason = blockReason(state, id);
  const armReason = blockReason(state, id, { ignoreFunds: true, forArming: true });
  const tp = tpWith(state, m.hazard, id);
  const sugg = suggestedTrigger(state, id);
  const [open, setOpen] = useState(false);
  const [thr, setThr] = useState("");
  const status = cur?.status;

  const thrValue = thr === "" ? (sugg ?? hz.xMin) : Number(thr);
  const step = hz.unit === "m" ? 0.01 : hz.unit === "×" ? 0.05 : 0.5;
  const toFixedU = (v) => (hz.unit === "m" ? v.toFixed(2) : hz.unit === "×" ? v.toFixed(2) : v.toFixed(1));

  return (
    <article className={`measure ${status ?? ""}`}>
      <header>
        <h5>{m.name}</h5>
        {status && (
          <span className={`badge ${status}`}>
            {status === "active" && "✓ Active"}
            {status === "building" && `🏗 Ready ${cur.readyYear}`}
            {status === "armed" && `⏱ Trigger at ${hz.fmt(cur.threshold)}${cur.waiting ? " (waiting)" : ""}`}
          </span>
        )}
      </header>
      <div className="tags">
        {m.tags.map((t) => (
          <span key={t} className="tag" style={{ background: TAG_INFO[t].color }} title={TAG_INFO[t].tip}>
            {TAG_INFO[t].label}
          </span>
        ))}
      </div>
      <p className="desc">{m.desc}</p>
      <dl className="stats">
        <div>
          <dt>Capital</dt>
          <dd>€{cost.toFixed(1)}M</dd>
        </div>
        <div>
          <dt>Lead time</dt>
          <dd>{m.lead} yrs</dd>
        </div>
        <div>
          <dt>Running</dt>
          <dd>€{(m.opex * state.base[m.hazard]).toFixed(2)}M/yr</dd>
        </div>
        <div>
          <dt>Effect</dt>
          <dd>{effectText(m)}</dd>
        </div>
      </dl>
      {status !== "active" && status !== "building" && (
        <p className="tp-gain">
          Plan tipping point with this:{" "}
          <b>{tp.exceeded ? "still failing" : isFinite(tp.x) ? hz.fmt(tp.x) : "beyond range"}</b>
        </p>
      )}
      {status !== "active" && status !== "building" && (
        <div className="actions">
          <button className="primary" disabled={!!reason} title={reason ?? ""} onClick={() => dispatch({ type: "commit", id })}>
            Implement now
          </button>
          {status === "armed" ? (
            <button onClick={() => dispatch({ type: "disarm", id })}>Cancel trigger</button>
          ) : (
            <button disabled={!!armReason} title={armReason ?? ""} onClick={() => setOpen(!open)}>
              Set trigger…
            </button>
          )}
          {reason && <span className="reason">{reason}</span>}
        </div>
      )}
      {open && status !== "armed" && (
        <div className="trigger-form">
          <label>
            Start automatically when the signpost ({hz.driver.toLowerCase()}) reaches
            <input
              type="number"
              step={step}
              value={thr === "" ? toFixedU(thrValue) : thr}
              onChange={(e) => setThr(e.target.value)}
            />
            <span>{hz.unit === "×" ? "× today" : hz.unit}</span>
          </label>
          <p className="muted small">
            {sugg != null
              ? `Suggested: ${hz.fmt(sugg)}. That's your current tipping point minus ${m.lead + 2} years of fast change, so the measure is ready in time even under a high-end future.`
              : "Your current plan doesn't reach a tipping point in range, so there's no trigger to suggest."}{" "}
            The signpost is now {hz.fmt(state.obs.length ? signpostNow(state, m.hazard) : 0)}.
          </p>
          <button
            className="primary"
            onClick={() => {
              dispatch({ type: "arm", id, threshold: thrValue });
              setOpen(false);
            }}
          >
            Arm trigger
          </button>
        </div>
      )}
    </article>
  );
}

function signpostNow(state, h) {
  const last = state.obs.filter((o) => o.year > state.year - 6);
  return last.reduce((s, o) => s + o.hazards[h], 0) / Math.max(1, last.length);
}

function MonitorTab({ state, hazard, st }) {
  const p = state.plausibility;
  return (
    <>
      <section>
        <h4 className="section-title">Which future fits the evidence?</h4>
        <p className="muted small">
          How well each scenario explains the observed global warming and sea-level signposts so far.
          It updates every turn. Early on the futures look alike, which is why you need a flexible plan.
        </p>
        {TRACKS.map((t) => (
          <div key={t} className="plaus">
            <span className="plaus-l">
              <i style={{ background: SCENARIO_BY_ID[t].color }} />
              {SCENARIO_BY_ID[t].label}
              {t === "highend" && " (low-likelihood, high-impact)"}
            </span>
            <Bar value={p[t]} max={1} color={SCENARIO_BY_ID[t].color} />
            <span className="plaus-v">{Math.round(p[t] * 100)}%</span>
          </div>
        ))}
      </section>
      <section>
        <h4 className="section-title">
          Signpost monitor: {HAZARDS[hazard].icon} {HAZARDS[hazard].driver}
        </h4>
        <SignpostChart state={state} hazard={hazard} plausibility={p} status={st} />
        <p className="muted small legend-line">
          Coloured lines show each scenario's expected path (thicker means more plausible). Dots are
          yearly observations and the dark line is their 5-year mean. The red dashes mark your
          committed plan's tipping point. Amber lines are armed triggers.
        </p>
      </section>
    </>
  );
}

function PathwaysTab({ state, hazard, st }) {
  const ids = state.available.filter((id) => MEASURE_BY_ID[id].hazard === hazard);
  return (
    <section>
      <h4 className="section-title">Adaptation pathways map</h4>
      <p className="muted small">
        Each bar shows how far along the hazard axis your committed plan carries once that measure is
        added. The bar ends at the plan's tipping point. The vertical line is today's signpost. The
        rows underneath show when each level is reached under each scenario, which gives every route
        a sell-by date. Choose a route that stays open across futures, and switch to the next measure
        before you reach the end of the current one.
      </p>
      <PathwaysMap state={state} hazard={hazard} candidates={ids} status={st} />
      <div className="legend-row">
        {["noRegret", "adaptive", "nature", "lockIn", "transformative"].map((t) => (
          <span key={t} className="tag" style={{ background: TAG_INFO[t].color }}>
            {TAG_INFO[t].label}
          </span>
        ))}
        <span className="tag" style={{ background: "#e09f3e" }}>
          Armed trigger
        </span>
      </div>
      <h4 className="section-title">Your committed and armed measures</h4>
      <ul className="plain">
        {Object.values(state.measures)
          .filter((x) => MEASURE_BY_ID[x.id].hazard === hazard)
          .map((x) => (
            <li key={x.id}>
              {x.status === "active" ? "✓" : x.status === "building" ? "🏗" : "⏱"} {shortName(MEASURE_BY_ID[x.id].name)}{" "}
              <span className="muted">
                {x.status === "armed"
                  ? `trigger at ${HAZARDS[hazard].fmt(x.threshold)}`
                  : `committed ${x.committedYear}${x.mode === "trigger" ? " by trigger" : ""}, ready ${x.readyYear}`}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

function LogTab({ state }) {
  const ev = [...state.events].reverse();
  if (!ev.length) return <p className="muted">Nothing has happened yet. Make your first decisions, then advance time.</p>;
  return (
    <ul className="log">
      {ev.map((e, i) => (
        <li key={i} className={e.kind}>
          <span className="log-y">{e.year}</span>
          <span>{HAZARDS[e.hazard]?.icon}</span>
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}
