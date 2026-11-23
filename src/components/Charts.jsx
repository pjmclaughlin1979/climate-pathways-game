import { HAZARDS, MEASURE_BY_ID, TAG_INFO } from "../data/measures.js";
import { SCENARIO_BY_ID, TRACKS, expectedClimate } from "../data/climate.js";
import { trajectories } from "../engine/selectors.js";
import { tippingPoint, portfolioEffect } from "../engine/risk.js";
import { ownedIds, ctxOf } from "../engine/game.js";

const W = 420;

/**
 * Signpost monitor: expected trajectory of the hazard driver under each scenario,
 * with the observations so far, the tipping point of the committed portfolio, and any
 * armed triggers.
 */
export function SignpostChart({ state, hazard, plausibility, status }) {
  const hz = HAZARDS[hazard];
  const H = 210;
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const x0 = 2005;
  const x1 = 2100;
  const traj = trajectories(state.countyId, hazard, x0, x1, 5);
  const obs = state.obs.map((o) => [o.year, o.hazards[hazard]]);
  const allY = [...Object.values(traj).flat().map((p) => p[1]), ...obs.map((p) => p[1])];
  let yMin = Math.min(hz.xMin, ...allY);
  let yMax = Math.max(...allY) * 1.05;

  const tp = status?.tpOwned;
  if (tp && isFinite(tp.x) && tp.x < yMax * 1.4) yMax = Math.max(yMax, tp.x * 1.05);
  const sx = (y) => pad.l + ((y - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const line = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
  const ticks = niceTicks(yMin, yMax, 4);
  const armed = Object.values(state.measures).filter(
    (m) => m.status === "armed" && MEASURE_BY_ID[m.id].hazard === hazard
  );
  // running mean of observations
  const rm = state.obs.map((o, i, a) => {
    const w = a.slice(Math.max(0, i - 4), i + 1);
    return [o.year, w.reduce((s, x) => s + x.hazards[hazard], 0) / w.length];
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${hz.label} signpost chart`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={pad.l - 6} y={sy(t) + 3} className="tick" textAnchor="end">
            {hz.fmt(t)}
          </text>
        </g>
      ))}
      {[2025, 2050, 2075, 2100].map((y) => (
        <text key={y} x={sx(y)} y={H - 6} className="tick" textAnchor="middle">
          {y}
        </text>
      ))}
      <rect x={sx(state.year)} y={pad.t} width={W - pad.r - sx(state.year)} height={H - pad.t - pad.b} className="future" />
      {TRACKS.map((t) => (
        <path
          key={t}
          d={line(traj[t])}
          fill="none"
          stroke={SCENARIO_BY_ID[t].color}
          strokeWidth={1.2 + 2.5 * (plausibility?.[t] ?? 0.2)}
          strokeDasharray={t === "highend" ? "4 3" : undefined}
          opacity={0.35 + 0.65 * (plausibility?.[t] ?? 0.2)}
        />
      ))}
      {obs.map(([y, v]) => (
        <circle key={y} cx={sx(y)} cy={sy(v)} r={1.8} className="obs" />
      ))}
      <path d={line(rm)} className="obs-line" fill="none" />
      {tp && isFinite(tp.x) && tp.x <= yMax && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={sy(tp.x)} y2={sy(tp.x)} className="tp-line" />
          <text x={W - pad.r - 2} y={sy(tp.x) - 4} className="tp-label" textAnchor="end">
            tipping point of your committed plan
          </text>
        </g>
      )}
      {armed.map((m) => (
        <g key={m.id}>
          <line x1={sx(state.year)} x2={W - pad.r} y1={sy(m.threshold)} y2={sy(m.threshold)} className="trig-line" />
          <text x={sx(state.year) + 3} y={sy(m.threshold) - 3} className="trig-label">
            ⏱ {shortName(MEASURE_BY_ID[m.id].name)}
          </text>
        </g>
      ))}
      <line x1={sx(state.year)} x2={sx(state.year)} y1={pad.t} y2={H - pad.b} className="now-line" />
      <text x={sx(state.year) + 3} y={pad.t + 10} className="tick">
        now
      </text>
    </svg>
  );
}

/**
 * DAPP pathways map. The x-axis is the hazard driver, so it holds for any scenario.
 * Each row shows how far the plan carries with that measure added before it reaches
 * its tipping point (bar). Below it, a timeline for each scenario shows when each
 * hazard level is reached.
 */
export function PathwaysMap({ state, hazard, candidates, status }) {
  const hz = HAZARDS[hazard];
  const { county, region } = ctxOf(state);
  const own = ownedIds(state.measures);
  const E = state.exposure[hazard];
  const tol = state.tolerance;
  const tpFor = (ids) => tippingPoint(hazard, portfolioEffect(hazard, ids), E, tol);
  const base = tpFor([]);
  const cur = tpFor(own);
  const rows = [
    { id: "_none", label: "No adaptation", tp: base, kind: "base" },
    { id: "_cur", label: "Your committed plan", tp: cur, kind: "cur" },
    ...candidates
      .filter((id) => !own.includes(id))
      .map((id) => ({
        id,
        label: shortName(MEASURE_BY_ID[id].name, 27),
        tp: tpFor([...own, id, ...MEASURE_BY_ID[id].requires]),
        kind: state.measures[id]?.status === "armed" ? "armed" : "opt",
        tags: MEASURE_BY_ID[id].tags,
      })),
  ];
  const xMax = hz.xMax;
  const rowH = 20;
  const pad = { l: 150, r: 14, t: 18 };
  const scenH = 15;
  const tracksH = TRACKS.length * scenH + 22;
  const H = pad.t + rows.length * rowH + tracksH + 6;
  const VW = W + 20;
  const sx = (v) => pad.l + ((Math.min(v, xMax) - hz.xMin) / (xMax - hz.xMin)) * (VW - pad.l - pad.r);
  const ticks = niceTicks(hz.xMin, xMax, 5);
  const axisY = pad.t + rows.length * rowH + 4;
  const sp = status?.signpost ?? 0;

  return (
    <svg viewBox={`0 0 ${VW} ${H}`} className="chart pathways" role="img" aria-label="Adaptation pathways map">
      <text x={pad.l} y={11} className="tick">
        {hz.driver} →
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={axisY} className="grid" />
          <text x={sx(t)} y={axisY + 11} className="tick" textAnchor="middle">
            {hz.fmt(t)}
          </text>
        </g>
      ))}
      <line x1={sx(Math.max(hz.xMin, sp))} x2={sx(Math.max(hz.xMin, sp))} y1={pad.t - 4} y2={H - 4} className="now-line" />
      {rows.map((r, i) => {
        const y = pad.t + i * rowH + rowH / 2;
        const end = r.tp.exceeded ? hz.xMin : r.tp.x;
        const color =
          r.kind === "cur" ? "#1d3557" : r.kind === "base" ? "#9a9a9a" : r.kind === "armed" ? "#e09f3e" : tagColor(r.tags);
        return (
          <g key={r.id}>
            <text x={pad.l - 8} y={y + 3.5} className={`row-label ${r.kind}`} textAnchor="end">
              {r.label}
            </text>
            {r.tp.exceeded ? (
              <text x={sx(hz.xMin) + 4} y={y + 3.5} className="tick warn">
                objective already failed
              </text>
            ) : (
              <>
                <line x1={sx(hz.xMin)} x2={sx(end)} y1={y} y2={y} stroke={color} strokeWidth={r.kind === "cur" ? 6 : 4} strokeLinecap="round" />
                {isFinite(end) && end < xMax ? (
                  <line x1={sx(end)} x2={sx(end)} y1={y - 7} y2={y + 7} stroke={color} strokeWidth={2.5} />
                ) : (
                  <text x={sx(xMax) + 3} y={y + 4} className="tick">
                    ▶
                  </text>
                )}
              </>
            )}
            {r.kind === "cur" && isFinite(cur.x) && !cur.exceeded && (
              <line x1={sx(cur.x)} x2={sx(cur.x)} y1={y} y2={pad.t + rows.length * rowH - 4} className="transfer" />
            )}
          </g>
        );
      })}
      <text x={pad.l - 8} y={axisY + 26} className="tick" textAnchor="end">
        Reached in year…
      </text>
      {TRACKS.map((t, i) => {
        const y = axisY + 22 + i * scenH;
        const sc = SCENARIO_BY_ID[t];
        const marks = [2040, 2060, 2080, 2100]
          .map((yr) => ({ yr, x: valueAt(county, region, hazard, t, yr) }))
          .filter((m) => m.x != null);
        return (
          <g key={t}>
            <text x={pad.l - 8} y={y + 4} className="tick" textAnchor="end" fill={sc.color}>
              {t === "highend" ? "High-end + ice" : sc.label}
            </text>
            <line x1={sx(hz.xMin)} x2={sx(xMax)} y1={y} y2={y} stroke={sc.color} strokeWidth={1} opacity={0.5} />
            {marks.map((m) =>
              m.x <= xMax && m.x >= hz.xMin ? (
                <g key={m.yr}>
                  <circle cx={sx(m.x)} cy={y} r={3} fill={sc.color} />
                  <text x={sx(m.x)} y={y - 4} className="tick tiny" textAnchor="middle">
                    {m.yr}
                  </text>
                </g>
              ) : null
            )}
          </g>
        );
      })}
    </svg>
  );
}

function valueAt(county, region, hazard, track, year) {
  return expectedClimate(county, region, track, year).hazards[hazard];
}

function tagColor(tags = []) {
  for (const t of ["adaptive", "nature", "transformative", "lockIn", "noRegret", "planning"])
    if (tags.includes(t)) return TAG_INFO[t].color;
  return "#457b9d";
}

export function shortName(name, max = 40) {
  const s = name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function niceTicks(min, max, n) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n + 1) ?? mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export function Bar({ value, max, color, marker }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      {marker != null && <div className="bar-marker" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} />}
    </div>
  );
}
