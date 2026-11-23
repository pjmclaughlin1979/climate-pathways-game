import { useMemo, useReducer, useState } from "react";
import MapView from "./components/MapView.jsx";
import SetupPanel from "./components/SetupPanel.jsx";
import GamePanel from "./components/GamePanel.jsx";
import { TurnReport, EndScreen, AboutModal } from "./components/Modals.jsx";
import { reducer, initialState, START_YEAR, END_YEAR, TURN_YEARS } from "./engine/game.js";
import { hazardStatus, MAP_VARIABLES } from "./engine/selectors.js";
import { HAZARD_IDS } from "./data/measures.js";
import { COUNTIES } from "./data/counties.js";
import { SCENARIO_BY_ID, TRACKS } from "./data/climate.js";

const eur = (v) => `€${Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-IE") : v.toFixed(1)}M`;

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [setup, setSetup] = useState({ countyId: null, difficulty: "standard", tolerance: 1.25 });
  const [explore, setExplore] = useState({ variable: "risk", track: "ssp245", year: 2050 });
  const [about, setAbout] = useState(false);

  const playing = state.phase === "playing" || state.phase === "ended";
  const hazards = useMemo(() => (playing ? HAZARD_IDS.filter((h) => state.base[h] > 0) : []), [playing, state.base]);
  const statuses = useMemo(
    () => (playing ? Object.fromEntries(hazards.map((h) => [h, hazardStatus(state, h)])) : {}),
    [playing, hazards, state]
  );

  const selectedCounty = playing ? state.countyId : setup.countyId;
  const turn = playing ? (state.year - START_YEAR) / TURN_YEARS + 1 : 0;
  const totalTurns = (END_YEAR - START_YEAR) / TURN_YEARS;

  const onCountyClick = (id) => {
    if (state.phase === "setup") setSetup((s) => ({ ...s, countyId: id }));
  };

  const start = () => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    dispatch({ type: "start", ...setup, seed });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⟿</span>
          <div>
            <b>Pathways Éire</b>
            <small>Climate adaptation under deep uncertainty</small>
          </div>
        </div>
        {playing && (
          <div className="hud">
            <Stat k="County" v={COUNTIES[state.countyId].name} />
            <Stat k={`Turn ${Math.min(turn, totalTurns)}/${totalTurns}`} v={state.phase === "ended" ? "2100" : `${state.year}–${state.year + TURN_YEARS - 1}`} />
            <Stat k="Budget" v={eur(state.balance)} cls={state.balance < 0 ? "bad" : ""} sub={`+${eur(state.income)}/yr`} />
            <Stat k="Damages so far" v={eur(state.totals.damages)} cls="bad" />
            <Stat k="Adaptation spend" v={eur(state.totals.capex + state.totals.opex)} />
          </div>
        )}
        <div className="top-actions">
          <button className="ghost" onClick={() => setAbout(true)}>
            About & data
          </button>
          {state.phase === "playing" && (
            <button className="primary" onClick={() => dispatch({ type: "advance" })}>
              Advance to {state.year + TURN_YEARS} ▶
            </button>
          )}
          {playing && (
            <button className="ghost" onClick={() => confirm("Abandon this game?") && dispatch({ type: "reset" })}>
              New game
            </button>
          )}
        </div>
      </header>

      <main className="main">
        <div className="map-col">
          <MapView
            variable={explore.variable}
            track={explore.track}
            year={explore.year}
            selectedCounty={selectedCounty}
            onCountyClick={onCountyClick}
          />
          <div className="explore card">
            <div className="explore-title">Explore the projections</div>
            <select
              aria-label="Map variable"
              value={explore.variable}
              onChange={(e) => setExplore({ ...explore, variable: e.target.value })}
            >
              {Object.entries(MAP_VARIABLES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.short}
                </option>
              ))}
            </select>
            <div className="chips">
              {TRACKS.map((t) => (
                <button
                  key={t}
                  className={explore.track === t ? "on" : ""}
                  style={{ "--c": SCENARIO_BY_ID[t].color }}
                  onClick={() => setExplore({ ...explore, track: t })}
                  title={SCENARIO_BY_ID[t].name}
                >
                  {SCENARIO_BY_ID[t].short}
                </button>
              ))}
            </div>
            <label className="year">
              <input
                type="range"
                min={2030}
                max={2100}
                step={10}
                value={explore.year}
                onChange={(e) => setExplore({ ...explore, year: Number(e.target.value) })}
              />
              <b>{explore.year}</b>
            </label>
            <p className="muted tiny">
              {SCENARIO_BY_ID[explore.track].name}. {state.phase === "setup" ? "Click a county to choose it." : "Click any county for details."}
            </p>
          </div>
        </div>

        <aside className="side">
          {state.phase === "setup" ? (
            <SetupPanel setup={setup} setSetup={setSetup} onStart={start} onAbout={() => setAbout(true)} />
          ) : (
            <GamePanel key={state.seed} state={state} statuses={statuses} hazards={hazards} dispatch={dispatch} />
          )}
        </aside>
      </main>

      {state.phase === "playing" && state.lastTurn && <TurnReport state={state} onClose={() => dispatch({ type: "dismissTurn" })} />}
      {state.phase === "ended" && <EndScreen state={state} onRestart={() => dispatch({ type: "reset" })} />}
      {about && <AboutModal onClose={() => setAbout(false)} />}
    </div>
  );
}

function Stat({ k, v, sub, cls = "" }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className={`v ${cls}`}>{v}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
