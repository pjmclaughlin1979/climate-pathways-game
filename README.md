# Pathways Éire: a climate adaptation planning game

A serious game for planning climate adaptation in an Irish county under deep uncertainty,
built on **Dynamic Adaptive Policy Pathways (DAPP)** principles. It uses React 19 and the
**ArcGIS Maps SDK for JavaScript 5.2** (`@arcgis/map-components` + `@arcgis/core`).

```bash
npm install
npm run dev      # http://localhost:5181
npm run build
```

No API key or sign-in is needed. The basemap is Esri's public canvas tiles, and county
boundaries come live from Tailte Éireann's public feature service.

## How it plays

1. Pick a county (on the map or from the list), a budget level and a **risk objective**, which
   is the most expected annual damage you'll accept as a multiple of today's.
2. A hidden future is drawn: an SSP scenario, a climate-sensitivity multiplier, and possibly
   ice-sheet instability. You're never told which.
3. Each 5-year turn (2025 → 2100) you can, for each hazard (coastal flooding, river and
   surface-water flooding, heat, drought and water supply):
   - **Implement now**: pay the capital cost; the measure takes effect after its lead time.
   - **Set a trigger**: arm a measure to start automatically when the hazard **signpost**
     (5-year running mean of observations) crosses a value. The suggested value is
     *tipping point − (lead time + 2 yrs) × plausible fast rate of change*.
4. Advancing simulates each year: triggers, construction, noisy observations, exposure
   growth (including the *levee effect*), random extreme events, damages and running costs.
   The **Monitor** tab updates how well each scenario explains the evidence.
5. The **Pathways map** tab is a DAPP metro map. The x-axis is the hazard level; bars end at
   each option's adaptation tipping point; the rows underneath give a sell-by year per scenario.
6. In 2100 the real future is revealed, and your plan (commitments and triggers) is
   **stress-tested** in every scenario against three benchmarks: an expert adaptive pathway,
   "build high-end now", and "do nothing". You're graded on **max regret** (robustness).

## Where things live

| File | Purpose |
| --- | --- |
| `src/data/counties.js` | 26 county profiles: population, exposure indices, baseline damages |
| `src/data/climate.js` | SSP warming-level and sea-level trajectories, and county downscaling |
| `src/data/measures.js` | Hazards, risk-response curves, adaptation measures, benchmark plans |
| `src/engine/world.js` | Hidden world, seeded noise, observations, signposts, scenario plausibility |
| `src/engine/risk.js` | Portfolio effects, expected annual damage, tipping points, sell-by dates, trigger suggestions |
| `src/engine/game.js` | Pure reducer (deterministic given the seed) |
| `src/engine/stressTest.js` | Replays plans across scenarios; regret |
| `src/components/MapView.jsx` | `<arcgis-map>` with a client-side county FeatureLayer, class-breaks renderer, popups and legend |

## Data, and how to make it research-grade

- Global warming levels and global mean sea level: IPCC AR6 WGI central estimates per SSP;
  the ice-sheet track adds about 0.9 m by 2100.
- County signals: an **indicative** downscaling tuned to the headline findings of Met
  Éireann's TRANSLATE projections and EPA Research Report 339 (Nolan & Flanagan 2020).
  TRANSLATE isn't published as an ArcGIS service, so to use the real data, aggregate the
  gridded TRANSLATE NetCDF output to counties by warming level and return it from
  `countyClimate()` in `src/data/climate.js`. The engine only depends on that function's
  return shape.
- Design standards echo the OPW's Mid-Range (+20% flows) and High-End (+30% flows, +1 m sea
  level) Future Scenarios.
- Exposure and costs are stylised and scale with Census 2022 population and expert-judgement
  indices. This is a learning tool, not an investment appraisal.
