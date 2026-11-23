import { HAZARDS, HAZARD_IDS, MEASURE_BY_ID } from "../data/measures.js";
import { SCENARIO_BY_ID, TRACKS } from "../data/climate.js";
import { COUNTIES } from "../data/counties.js";
import { STRATEGIES } from "../engine/stressTest.js";
import { shortName } from "./Charts.jsx";

export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          {onClose && (
            <button className="icon" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const ordinal = (n) => {
  const t = n % 100;
  const suf = t >= 11 && t <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suf}`;
};

const eur = (v) => `€${v >= 100 ? Math.round(v).toLocaleString("en-IE") : v.toFixed(1)}M`;

export function TurnReport({ state, onClose }) {
  const t = state.lastTurn;
  const total = HAZARD_IDS.reduce((s, h) => s + (t.damage[h] || 0), 0);
  return (
    <Modal title={`${t.from}–${t.to - 1} in review`} onClose={onClose}>
      <div className="report-grid">
        <div>
          <div className="k">Climate damage</div>
          <div className="v bad">{eur(total)}</div>
        </div>
        <div>
          <div className="k">Running costs</div>
          <div className="v">{eur(t.opex)}</div>
        </div>
        <div>
          <div className="k">Budget received</div>
          <div className="v ok">{eur(t.income)}</div>
        </div>
        <div>
          <div className="k">Balance now</div>
          <div className={`v ${state.balance < 0 ? "bad" : ""}`}>{eur(state.balance)}</div>
        </div>
      </div>
      <div className="dmg-split">
        {HAZARD_IDS.filter((h) => state.base[h]).map((h) => (
          <span key={h}>
            {HAZARDS[h].icon} {eur(t.damage[h] || 0)}
          </span>
        ))}
      </div>
      <h4 className="section-title">What happened</h4>
      {t.events.length ? (
        <ul className="log">
          {t.events.map((e, i) => (
            <li key={i} className={e.kind}>
              <span className="log-y">{e.year}</span>
              <span>{HAZARDS[e.hazard]?.icon}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">A quiet five years: no major events.</p>
      )}
      <h4 className="section-title">How the evidence moved</h4>
      <div className="shift">
        {TRACKS.map((k) => {
          const a = t.plausibilityBefore[k];
          const b = state.plausibility[k];
          const d = b - a;
          return (
            <div key={k} className="shift-row">
              <i style={{ background: SCENARIO_BY_ID[k].color }} />
              <span>{SCENARIO_BY_ID[k].label}</span>
              <b>{Math.round(b * 100)}%</b>
              <span className={d > 0.02 ? "up" : d < -0.02 ? "down" : "muted"}>
                {d > 0.02 ? "▲" : d < -0.02 ? "▼" : "–"} {Math.abs(Math.round(d * 100))}
              </span>
            </div>
          );
        })}
      </div>
      <button className="primary big" onClick={onClose}>
        Plan for {t.to}–{Math.min(2099, t.to + 4)} →
      </button>
    </Modal>
  );
}

function grade(stress) {
  const r = stress.regret;
  const best = Math.min(r.expert, r.static, r.none);
  // Judge against the static "build high-end now" plan: a sensible but inflexible baseline.
  const ratio = r.yours / Math.max(1, r.static);
  if (r.yours <= best * 1.05 + 1) return { g: "A+", t: "Your plan was the most robust strategy tested." };
  if (ratio < 0.5) return { g: "A", t: "Highly robust. Far less regret than building to the high-end standard straight away." };
  if (ratio < 1) return { g: "B", t: "Robust. You beat a static high-end design, but better-timed triggers would have saved more." };
  if (ratio < 3) return { g: "C", t: "Partly robust. At least one plausible future would have cost you dearly." };
  return { g: "D", t: "Fragile. In some plausible futures this plan does little better than doing nothing." };
}

export function EndScreen({ state, onRestart }) {
  const { stress, world, totals } = state;
  const sc = SCENARIO_BY_ID[world.scenarioId];
  const truth = world.ice ? "highend" : world.scenarioId;
  const gr = grade(stress);
  const maxTotal = Math.max(...TRACKS.flatMap((t) => STRATEGIES.map((s) => stress.results[t][s.id].total)));
  const triggered = Object.values(state.measures).filter((m) => m.mode === "trigger");
  const fired = triggered.filter((m) => m.status !== "armed");
  const lockins = Object.values(state.measures).filter((m) => MEASURE_BY_ID[m.id].tags.includes("lockIn") && m.status !== "armed");
  const adaptive = Object.values(state.measures).filter((m) => MEASURE_BY_ID[m.id].tags.includes("adaptive") && m.status !== "armed");

  return (
    <Modal title={`2100: ${COUNTIES[state.countyId].name}'s adaptation story`} wide>
      <div className="reveal">
        <div>
          <div className="k">The future that actually unfolded</div>
          <div className="v" style={{ color: sc.color }}>
            {sc.label} · {sc.name}
          </div>
          <div className="muted small">
            Climate sensitivity {world.sensitivity.toFixed(2)}× central ·{" "}
            {world.ice ? "ice-sheet instability: YES (high-end sea-level rise)" : "no ice-sheet instability"} ·
            Irish regional response at the {ordinal(Math.round(50 + 40 * (world.regional ?? 0)))} percentile of the
            TRANSLATE ensemble
          </div>
        </div>
        <div className="grade">
          <span>{gr.g}</span>
          <p>{gr.t}</p>
        </div>
      </div>

      <div className="report-grid">
        <div>
          <div className="k">Damages (present value)</div>
          <div className="v bad">{eur(totals.npvDamage)}</div>
        </div>
        <div>
          <div className="k">Adaptation spend (present value)</div>
          <div className="v">{eur(totals.npvCost)}</div>
        </div>
        <div>
          <div className="k">Total cost to society</div>
          <div className="v">{eur(totals.npvDamage + totals.npvCost)}</div>
        </div>
        <div>
          <div className="k">Triggers fired / armed</div>
          <div className="v">
            {fired.length} / {triggered.length}
          </div>
        </div>
      </div>

      <h4 className="section-title">Stress test: your plan replayed in every future</h4>
      <p className="muted small">
        Each plan's fixed commitments and triggers are replayed against the expected climate of each
        scenario. Figures are present value of damage plus adaptation cost (4% discount rate) and
        assume money is available when a trigger fires. ★ marks the cheapest plan in each future.
        Max regret is the most a plan costs above the best plan in its worst future. Lower is more
        robust.
      </p>
      <table className="stress">
        <thead>
          <tr>
            <th>Strategy</th>
            {TRACKS.map((t) => (
              <th key={t} className={t === truth ? "truth" : ""}>
                {SCENARIO_BY_ID[t].label}
                {t === truth && <div className="small">what happened</div>}
              </th>
            ))}
            <th>Max regret</th>
          </tr>
        </thead>
        <tbody>
          {STRATEGIES.map((s) => (
            <tr key={s.id} className={s.id === "yours" ? "yours" : ""}>
              <td>{s.label}</td>
              {TRACKS.map((t) => {
                const v = stress.results[t][s.id].total;
                const best = Math.min(...STRATEGIES.map((x) => stress.results[t][x.id].total));
                return (
                  <td key={t} className={t === truth ? "truth" : ""}>
                    <div className="cell-bar" style={{ width: `${(v / maxTotal) * 100}%`, background: s.color }} />
                    <span>
                      {eur(v)}
                      {v <= best + 1e-6 ? " ★" : ""}
                    </span>
                  </td>
                );
              })}
              <td>
                <b>{eur(stress.regret[s.id])}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="section-title">Lessons from your pathway</h4>
      <ul className="lessons">
        {adaptive.length > 0 && (
          <li>
            You chose adaptive designs ({adaptive.map((m) => shortName(MEASURE_BY_ID[m.id].name)).join(", ")}). Paying
            for flexibility up front made later upgrades fast and cheap.
          </li>
        )}
        {lockins.length > 0 && (
          <li>
            You committed to measures that carry lock-in risk ({lockins.map((m) => shortName(MEASURE_BY_ID[m.id].name)).join(", ")}).
            Look at the high-end column to see whether they boxed you in.
          </li>
        )}
        {triggered.length === 0 && (
          <li>
            You never armed a trigger. Signpost-based triggers are what make a plan adaptive: they
            commit you to act when the evidence changes, not on a fixed timetable.
          </li>
        )}
        {fired.length > 0 && (
          <li>
            {fired.length} trigger{fired.length > 1 ? "s" : ""} fired. Each was a decision made in
            advance and carried out when the signpost said so. That's DAPP in practice.
          </li>
        )}
        <li>
          The benchmark adaptive pathway commits only no-regret measures at the start and arms adaptive
          upgrades with triggers. Compare its max regret with "Build high-end now", which overspends in
          mild futures.
        </li>
      </ul>
      <button className="primary big" onClick={onRestart}>
        Play again in a new future
      </button>
    </Modal>
  );
}

export function AboutModal({ onClose }) {
  return (
    <Modal title="About Pathways Éire" onClose={onClose} wide>
      <div className="about">
        <section>
          <h3>Dynamic Adaptive Policy Pathways (DAPP)</h3>
          <p>
            DAPP (Haasnoot et al., 2013) is a way to make decisions under <b>deep uncertainty</b>:
            when nobody can agree on the probability of each future. Instead of optimising for one
            forecast, you:
          </p>
          <ol>
            <li>
              Set an <b>objective</b>. Here it's the most expected annual damage you'll accept,
              compared with today.
            </li>
            <li>
              Find each action's <b>adaptation tipping point</b>: the climate condition at which it
              stops meeting the objective.
            </li>
            <li>
              Map <b>pathways</b>: sequences of actions, each taking over before the last one's
              tipping point. Scenarios turn tipping points into <b>sell-by dates</b>.
            </li>
            <li>
              Prefer pathways that keep options open, and watch for <b>lock-in</b> and path
              dependency.
            </li>
            <li>
              Set up <b>monitoring</b> with <b>signposts</b> and <b>triggers</b>. A trigger value must
              leave enough time for the next action's lead time.
            </li>
          </ol>
          <p>
            Here a five-year turn plays out year by year. Measures take years to build, extreme
            events are random, exposure grows unless you control development, and some designs can
            be upgraded while others must be rebuilt.
          </p>
        </section>
        <section>
          <h3>Data and model</h3>
          <ul>
            <li>
              <b>County boundaries</b> come live from Tailte Éireann's National Statutory Boundaries
              (generalised 20 m) feature service, © Tailte Éireann, CC BY 4.0, rendered with the
              ArcGIS Maps SDK for JavaScript 5.2.
            </li>
            <li>
              <b>Global warming levels</b> per SSP and <b>global mean sea-level rise</b> use IPCC AR6
              WGI central estimates. The ice-sheet track adds about 0.9 m by 2100, reflecting AR6's
              low-likelihood, high-impact range.
            </li>
            <li>
              <b>Irish county signals</b> are Met Éireann's TRANSLATE projections (CMIP5 regional
              model ensemble; O'Brien &amp; Nolan, 2023), downloaded from{" "}
              <a href="https://www.climateservices.ie/TRANSLATE/" target="_blank" rel="noreferrer">
                climateservices.ie/TRANSLATE
              </a>
              . The 1.5 km grids for annual mean temperature, summer rainfall, wettest-day rainfall
              (Rx1day) and summer days above 25 °C are averaged over each county at 1.5, 2, 2.5, 3 and
              4 °C of global warming, relative to 1976–2005. The game interpolates between warming
              levels and extrapolates beyond 4 °C. Each hidden future also places Ireland somewhere
              between the ensemble's 10th and 90th percentiles.
            </li>
            <li>
              <b>Design standards</b> echo the OPW's Mid-Range (+20% flows) and High-End (+30% flows,
              +1 m sea level) Future Scenarios.
            </li>
            <li>
              <b>Flood exposure</b> comes from OPW flood maps on{" "}
              <a href="https://www.floodinfo.ie/" target="_blank" rel="noreferrer">
                floodinfo.ie
              </a>
              : National Coastal Flood Hazard Mapping 2021, plus CFRAM community-scale and NIFM river
              flood extents. They're overlaid on Census 2022 Small Area population to count the
              people inside each flood zone at three flood probabilities, for each OPW scenario
              (sea level +0.5 to +2.0 m; river flows +20% and +30%). That sets each county's
              baseline flood damage and the shape of its damage curve as the climate changes. The
              maps ignore existing defences. The € value is calibrated so national river-flood
              damage matches the Central Bank of Ireland's 2024 estimate of about €101m a year
              for inland flooding. Coastal flooding uses the same rate. The maps show where floods
              reach, not how deep, so the game adds an assumed depth factor: damage per person
              rises 100% per 0.5 m of sea-level rise and 50% per 30% increase in river flows.
            </li>
            <li>
              <b>Water supply</b> comes from Uisce Éireann's National Water Resources Plan
              (Appendix L: Supply Demand Balance summaries for 535 Water Resource Zones). Zones are
              split across counties by the population each county's Water Supply Zones draw from
              them. The Greater Dublin Area zone, for example, is split across Dublin, Kildare, Meath
              and Wicklow. Each county's dry-year critical-period deficit in 2019 sets its baseline,
              and Uisce Éireann's 2044 forecast sets how fast it grows (at half that rate after 2044).
              The ratio of demand to available supply in its deficit zones shapes how drier summers
              deepen the deficit. The water signpost is that deficit index (1 = today, before new
              measures), so water triggers respond to demand growth as well as to drier summers,
              the way supply-demand balances are monitored in practice. A
              leakage programme recovers the gap between the county's real leakage and a 23%
              target. A strategic transfer, sized like the 300,000 m³/day Water Supply Project, is
              only open to counties on the Greater Dublin supply. Unmet demand is valued at €2 per m³
              over 60 critical-period days a year, and yields are assumed to fall in proportion to
              summer rainfall. Both are game assumptions.
            </li>
            <li>
              <b>Heat exposure</b> is stylised. It scales with Census 2022 population and an
              urban-heat index. All costs scale with each county's baseline damage.
            </li>
          </ul>
          <p className="warn-note">
            This is a serious game for learning and discussion. It isn't an engineering or
            investment appraisal. Climate signals are real TRANSLATE data and flood exposure is
            derived from real OPW flood maps, and water supply from Uisce Éireann's plan. But
            people are spread evenly across each Small Area, the maps are strategic (not
            property-level), and the € values are assumptions.
          </p>
        </section>
      </div>
    </Modal>
  );
}
