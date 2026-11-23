"""Aggregate Met Éireann TRANSLATE gridded projections to Irish counties.

Usage:
    python scripts/aggregate_translate.py <dir-with-extracted-.nc-files> src/data/translateCounties.json

Inputs are the NetCDF files inside the TRANSLATE zips published at
https://www.climateservices.ie/TRANSLATE/ (CMIP5 ensemble, 1976-2005 baseline):
    tmean_CMIP5_{gwl}deg_{ensmean|ens10|ens90}_chg_ANNUAL.nc   (°C change, annual mean temperature)
    tot_prec_CMIP5_{gwl}deg_{ensmean|ens10|ens90}_chg_JJA.nc   (% change, summer rainfall)
    rx1day_CMIP5_{gwl}deg_{ensmean|ens10|ens90}_chg_ANNUAL.nc  (% change, wettest day of the year)
    su_CMIP5_{gwl}deg_{ensmean|ens10|ens90}_chg_ANNUAL.nc      (change in summer days, Tmax > 25 °C)
    su_CMIP5_baseline_1976-2005_ANNUAL.nc                      (summer days in the baseline)
for gwl in 1.5, 2.0, 2.5, 3.0, 4.0.

County boundaries: Tailte Éireann National Statutory Boundaries (generalised 20 m), CC BY 4.0.
Each county value is the mean of the grid cells whose centres fall inside the county.
Needs: numpy, netCDF4, shapely >= 2.
"""
import json
import os
import sys
import urllib.request

import netCDF4
import numpy as np
import shapely
from shapely.geometry import shape

COUNTIES_URL = (
    "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/ArcGIS/rest/services/"
    "Counties___OSi_National_Statutory_Boundaries___Generalised_20m/FeatureServer/0/query"
    "?where=1%3D1&outFields=COUNTY&outSR=4326&f=geojson"
)
GWLS = ["1.5", "2.0", "2.5", "3.0", "4.0"]
VARS = {
    "tmean": ("tmean_CMIP5_{g}deg_{s}_chg_ANNUAL.nc", "°C"),
    "summerRain": ("tot_prec_CMIP5_{g}deg_{s}_chg_JJA.nc", "%"),
    "rx1day": ("rx1day_CMIP5_{g}deg_{s}_chg_ANNUAL.nc", "%"),
    "summerDays": ("su_CMIP5_{g}deg_{s}_chg_ANNUAL.nc", "days"),
}
STATS = {"mean": "ensmean", "p10": "ens10", "p90": "ens90"}


def find(root, name):
    for d, _, files in os.walk(root):
        if name in files:
            return os.path.join(d, name)
    raise FileNotFoundError(name)


def read(path):
    ds = netCDF4.Dataset(path)
    var = [v for v in ds.variables if ds.variables[v].ndim >= 2][0]
    a = np.ma.filled(np.ma.masked_invalid(ds.variables[var][:]).squeeze().astype("float64"), np.nan)
    a[np.abs(a) > 1e20] = np.nan
    return ds.variables["lat"][:].astype("float64"), ds.variables["lon"][:].astype("float64"), a


def main(root, out):
    with urllib.request.urlopen(COUNTIES_URL) as r:
        gj = json.load(r)
    polys = {f["properties"]["COUNTY"]: shape(f["geometry"]) for f in gj["features"]}
    for g in polys.values():
        shapely.prepare(g)

    lat, lon, _ = read(find(root, "su_CMIP5_baseline_1976-2005_ANNUAL.nc"))
    LON, LAT = np.meshgrid(lon, lat)
    masks = {c: shapely.contains_xy(g, LON, LAT) for c, g in polys.items()}

    def agg(a):
        res = {}
        for c, m in masks.items():
            vals = a[m]
            vals = vals[~np.isnan(vals)]
            res[c] = round(float(vals.mean()), 3) if vals.size else None
        return res

    data = {}
    for key, (pattern, unit) in VARS.items():
        data[key] = {"unit": unit, "values": {}}
        for stat, s in STATS.items():
            per_gwl = []
            for g in GWLS:
                la, lo, a = read(find(root, pattern.format(g=g, s=s)))
                assert la.shape == lat.shape and np.allclose(la, lat, atol=1e-4) and np.allclose(lo, lon, atol=1e-4)
                per_gwl.append(agg(a))
            for c in masks:
                data[key]["values"].setdefault(c, {})[stat] = [d[c] for d in per_gwl]

    _, _, su0 = read(find(root, "su_CMIP5_baseline_1976-2005_ANNUAL.nc"))
    result = {
        "source": "Met Éireann TRANSLATE (CMIP5 ensemble; O'Brien & Nolan 2023), https://www.climateservices.ie/TRANSLATE/",
        "baselinePeriod": "1976-2005",
        "gwls": [float(g) for g in GWLS],
        "cells": {c: int(m.sum()) for c, m in masks.items()},
        "baselineSummerDays": agg(su0),
        "vars": data,
    }
    with open(out, "w") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {out}: {len(masks)} counties")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
