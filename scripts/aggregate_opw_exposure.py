"""Estimate flood exposure per Irish county from OPW flood maps and Census 2022 population.

Usage:
    python scripts/aggregate_opw_exposure.py <download-dir> src/data/opwExposure.json

<download-dir> must contain these unmodified downloads:
  OPW National Coastal Flood Hazard Mapping 2021 (data.gov.ie / floodinfo.ie), one zip per scenario:
    ncfhm_itm_ext_c_{c,m,h,hplus,hplusplus}_1000yr_200yr_10yr.zip
      current, +0.5 m (MRFS), +1.0 m (HEFS), +1.5 m (H+EFS), +2.0 m (H++EFS) sea level
  OPW CFRAM community-scale river flood extents:   cfram/esds_floodmap_ext_f_{c,m,h}.zip
  OPW National Indicative Fluvial Mapping (NIFM):  nifm/nifm_ext_f_{c,m,h}.zip
      current, +20% flows (MRFS), +30% flows (HEFS)
  Tailte Éireann CSO Small Areas 2022, generalised 20 m (GeoPackage):  small_areas_2022_gen20m.gpkg
  CSO Census 2022 SAPS by Small Area:  SAPS_2022_Small_Area_UR_171024.csv

Method (strategic, not property-level, as OPW advises for these maps):
  1. Rasterise every flood extent and the 18,919 Small Areas onto a common 25 m ITM grid.
     River extents are the union of CFRAM (towns) and NIFM (wider river network). Each future
     scenario's extent also includes the milder scenario's extent at the same probability:
     floods can't shrink as the climate worsens, and CFRAM high-end maps don't cover every town.
  2. People exposed in a Small Area = its population × the share of its area inside the extent.
  3. Sum by county for each scenario and each flood probability (AEP).
  4. Integrate people exposed over probability to get "expected people flooded per year",
     an expected-annual-exposure index used to scale each county's baseline flood damage and
     to shape how that damage grows with sea level or river flows.
The OPW maps generally ignore existing defences, so these figures are undefended exposure.
Needs: numpy, geopandas, pyogrio, rasterio, shapely.
"""
import csv
import json
import os
import sys
import warnings
import zipfile

import geopandas as gpd
import numpy as np
import rasterio.features
from rasterio.transform import from_origin

RES = 25.0
CRS = "EPSG:2157"
COASTAL = {"c": 0.0, "m": 0.5, "h": 1.0, "hplus": 1.5, "hplusplus": 2.0}  # m of sea-level rise
FLUVIAL = {"c": 0, "m": 20, "h": 30}  # % increase in flood flows
# (AEP label, probability) – the frequent river point unions CFRAM 10% and NIFM 5% extents.
COASTAL_AEPS = [("0010", 0.1), ("0200", 0.005), ("1000", 0.001)]
FLUVIAL_AEPS = [(("0010", "0020"), 0.1), (("0100", "0100"), 0.01), (("1000", "1000"), 0.001)]


def county_id(name):
    n = name.upper().replace(" CITY", "")
    if n.startswith(("NORTH TIPPERARY", "SOUTH TIPPERARY")):
        return "TIPPERARY"
    if n in ("FINGAL", "SOUTH DUBLIN", "DUN LAOGHAIRE/RATHDOWN", "DÚN LAOGHAIRE-RATHDOWN"):
        return "DUBLIN"
    return n


def read_shp_from_zip(zpath, suffix):
    with zipfile.ZipFile(zpath) as z:
        name = [n for n in z.namelist() if n.endswith(f"{suffix}.shp")]
    if not name:
        raise FileNotFoundError(f"{suffix}.shp in {zpath}")
    gdf = gpd.read_file(f"zip://{zpath}!{name[0]}", engine="pyogrio", columns=[])
    return gdf.to_crs(CRS) if gdf.crs and gdf.crs.to_string() != CRS else gdf


warnings.filterwarnings("ignore", message=".*invalid winding order.*")


def main(root, out):
    p = lambda f: os.path.join(root, f)
    sa = gpd.read_file(p("small_areas_2022_gen20m.gpkg"), engine="pyogrio",
                       columns=["SA_GUID_2022", "COUNTY_ENGLISH"]).to_crs(CRS)
    pop = {}
    with open(p("SAPS_2022_Small_Area_UR_171024.csv"), encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pop[row["GUID"]] = int(row["T1_1AGETT"])
    sa["pop"] = sa["SA_GUID_2022"].map(pop).fillna(0).astype(float)
    sa["county"] = sa["COUNTY_ENGLISH"].map(county_id)
    missing = int((~sa["SA_GUID_2022"].isin(pop.keys())).sum())

    minx, miny, maxx, maxy = sa.total_bounds
    width = int(np.ceil((maxx - minx) / RES))
    height = int(np.ceil((maxy - miny) / RES))
    transform = from_origin(minx, maxy, RES, RES)
    print(f"grid {width} x {height} at {RES} m; {len(sa)} small areas, {missing} without SAPS match", flush=True)

    labels = rasterio.features.rasterize(
        ((g, i + 1) for i, g in enumerate(sa.geometry)), out_shape=(height, width),
        transform=transform, fill=0, dtype="int32")
    n_sa = len(sa) + 1
    sa_cells = np.bincount(labels.ravel(), minlength=n_sa).astype(float)
    sa_pop = np.concatenate([[0.0], sa["pop"].to_numpy()])
    sa_county = np.concatenate([[""], sa["county"].to_numpy()])
    counties = sorted(set(sa["county"]))

    def mask_for(layers):
        m = np.zeros((height, width), dtype="uint8")
        for gdf in layers:
            geoms = [g for g in gdf.geometry if g is not None and not g.is_empty]
            rasterio.features.rasterize(((g, 1) for g in geoms), out=m, transform=transform)
        return m

    def exposure(mask):
        flooded = np.bincount(labels.ravel(), weights=mask.ravel(), minlength=n_sa)
        share = np.divide(flooded, sa_cells, out=np.zeros(n_sa), where=sa_cells > 0)
        people = share * sa_pop
        return {c: float(people[sa_county == c].sum()) for c in counties}

    def expected_annual(points):
        # points: [(p, people)] sorted by decreasing p. No damage at the 2-year flood.
        pts = [(0.5, 0.0)] + points
        tot = sum(0.5 * (a[1] + b[1]) * (a[0] - b[0]) for a, b in zip(pts, pts[1:]))
        return tot + pts[-1][0] * pts[-1][1]

    result = {c: {"pop": float(sa_pop[sa_county == c].sum()), "coastal": {}, "fluvial": {}} for c in counties}

    prev = {}
    for scen in COASTAL:
        z = p(f"ncfhm_itm_ext_c_{scen}_1000yr_200yr_10yr.zip")
        per_aep = []
        for code, prob in COASTAL_AEPS:
            m = mask_for([read_shp_from_zip(z, f"_{code}")])
            if code in prev:
                m |= prev[code]
            prev[code] = m
            exp = exposure(m)
            per_aep.append((code, prob, exp))
            print(f"coastal {scen} {code}: {sum(exp.values()):,.0f} people", flush=True)
        for c in counties:
            pts = [(prob, exp[c]) for _, prob, exp in per_aep]
            result[c]["coastal"][scen] = {
                **{f"aep{code}": round(exp[c], 1) for code, _, exp in per_aep},
                "ead": round(expected_annual(pts), 3),
            }

    prev = {}
    for scen in FLUVIAL:
        zc = p(f"esds_floodmap_ext_f_{scen}.zip")
        zn = p(f"nifm_ext_f_{scen}.zip")
        per_aep = []
        for (cfram_code, nifm_code), prob in FLUVIAL_AEPS:
            m = mask_for([read_shp_from_zip(zc, f"_{cfram_code}"), read_shp_from_zip(zn, f"_{nifm_code}")])
            if nifm_code in prev:
                m |= prev[nifm_code]
            prev[nifm_code] = m
            exp = exposure(m)
            per_aep.append((nifm_code, prob, exp))
            print(f"fluvial {scen} {cfram_code}/{nifm_code}: {sum(exp.values()):,.0f} people", flush=True)
        for c in counties:
            pts = [(prob, exp[c]) for _, prob, exp in per_aep]
            result[c]["fluvial"][scen] = {
                **{f"aep{code}": round(exp[c], 1) for code, _, exp in per_aep},
                "ead": round(expected_annual(pts), 3),
            }

    doc = {
        "source": "OPW National Coastal Flood Hazard Mapping 2021, CFRAM community-scale and NIFM river "
                  "flood extents (floodinfo.ie / data.gov.ie); CSO Census 2022 SAPS; Tailte Éireann Small Areas 2022",
        "method": "Population in each Census 2022 Small Area weighted by the share of its area inside each OPW flood "
                  "extent (25 m raster), summed by county. 'ead' = expected people flooded per year, integrated "
                  "over flood probability. Undefended, strategic-scale.",
        "resolutionM": RES,
        "scenarios": {"coastal": COASTAL, "fluvial": FLUVIAL},
        "aeps": {"coastal": [a for a, _ in COASTAL_AEPS], "fluvial": ["0010/0020", "0100", "1000"]},
        "national": {
            hz: {sc: round(sum(result[c][hz][sc]["ead"] for c in counties), 1) for sc in scens}
            for hz, scens in (("coastal", COASTAL), ("fluvial", FLUVIAL))
        },
        "counties": result,
    }
    with open(out, "w") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
