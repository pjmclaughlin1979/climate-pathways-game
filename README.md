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
| `src/data/climate.js` | SSP warming-level and sea-level trajectories, and TRANSLATE interpolation per county |
| `src/data/translateCounties.json` | TRANSLATE projections averaged per county (generated) |
| `scripts/aggregate_translate.py` | Builds that JSON from the TRANSLATE NetCDF grids |
| `src/data/measures.js` | Hazards, risk-response curves, adaptation measures, benchmark plans |
| `src/engine/world.js` | Hidden world, seeded noise, observations, signposts, scenario plausibility |
| `src/engine/risk.js` | Portfolio effects, expected annual damage, tipping points, sell-by dates, trigger suggestions |
| `src/engine/game.js` | Pure reducer (deterministic given the seed) |
| `src/engine/stressTest.js` | Replays plans across scenarios; regret |
| `src/components/MapView.jsx` | `<arcgis-map>` with a client-side county FeatureLayer, class-breaks renderer, popups and legend |

## Data

- **County climate projections are real Met Éireann TRANSLATE data** (CMIP5 regional-model
  ensemble; O'Brien & Nolan 2023, *Frontiers in Climate* 5:1166828), downloaded from
  <https://www.climateservices.ie/TRANSLATE/>. Four variables are used: annual mean
  temperature, summer (JJA) rainfall, wettest-day rainfall (Rx1day) and summer days with
  Tmax > 25 °C. For each, `scripts/aggregate_translate.py` averages the 1.5 km grid over each
  county at 1.5, 2, 2.5, 3 and 4 °C of global warming (change vs 1976–2005), for the ensemble
  mean and the 10th and 90th percentiles. The result is committed as
  `src/data/translateCounties.json` (15 KB). `src/data/climate.js` interpolates between
  warming levels, extrapolates beyond 4 °C, and converts to change since today for the risk
  model. Each hidden future also places Ireland's regional response somewhere in the
  10th–90th percentile spread.
- Global warming levels and global mean sea level per SSP: IPCC AR6 WGI central estimates.
  TRANSLATE has no sea level. The ice-sheet track adds about 0.9 m by 2100.
- Design standards echo the OPW's Mid-Range (+20% flows) and High-End (+30% flows, +1 m sea
  level) Future Scenarios.
- Exposure and costs are stylised and scale with Census 2022 population and expert-judgement
  indices. This is a learning tool, not an investment appraisal. Replacing the exposure
  indices with CFRAM/NIFM damage data would be the next step towards research grade.

### Regenerating the TRANSLATE county data

```bash
# 1. Download these zips from https://www.climateservices.ie/TRANSLATE/ and unzip the .nc files:
#    tmean_CMIP5_{G}deg_ensmean_chg_ANNUAL, tot_prec_CMIP5_{G}deg_ensmean_chg_JJA,
#    rx1day_CMIP5_{G}deg_chg_ANNUAL, su_CMIP5_{G}deg_chg_ANNUAL   for G in 1.5 2.0 2.5 3.0 4.0
#    and su_CMIP5_baseline_1976-2005_ANNUAL
# 2. Then:
python -m venv .venv && .venv/bin/pip install numpy netCDF4 shapely
.venv/bin/python scripts/aggregate_translate.py <unzipped-dir> src/data/translateCounties.json
```
