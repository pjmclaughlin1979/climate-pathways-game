"""Aggregate Uisce Éireann water resource figures to Irish counties.

Usage:
    python scripts/aggregate_uisce_water.py <appendix-L.pdf> <wsz.xlsx> src/data/uisceWater.json

Inputs (Uisce Éireann, CC BY 4.0 where stated on https://www.water.ie/open-data):
  * National Water Resources Plan – Framework Plan, Appendix L "Supply Demand Balance Summaries"
    (2021). One page per Water Resource Zone (WRZ) with 2019 base demand components, demand +
    headroom forecasts and Water Available For Use (WAFU) and Supply Demand Balance (SDB) for
    2019–2044 under Normal Year Annual Average (NYAA), Dry Year Annual Average (DYAA) and Dry Year
    Critical Period (DYCP) conditions.
    https://water.widen.net/content/xypvwnwhsd/pdf/NWRP_FP-Appendix-L-Merged-final
  * Public Water Supply Zone Information (open data XLSX), population per Water Supply Zone
    with its Water Services Area (local authority) and WRZ code.
    https://water.widen.net/content/use17tawmb/original/Q1-2026-Public-Water-Supply-Zone-Information.xlsx

Each WRZ's figures are split across counties in proportion to the population each county's
Water Supply Zones draw from it (e.g. the Greater Dublin Area WRZ across Dublin, Kildare, Meath and
Wicklow). WRZs without a population match fall back to the local authority in their code.
Deficits are summed only over WRZs in deficit: a surplus in one zone can't supply another.
Needs: pypdf, fonttools, openpyxl.
"""
import json
import re
import sys
from collections import defaultdict

import openpyxl
from pypdf import PdfReader

YEARS = [2019, 2025, 2030, 2035, 2040, 2044]
# Local-authority code prefix in WRZ references (e.g. 0500SC0009 = Cork County Council).
LA_PREFIX = {
    "0100": "CARLOW", "0200": "CAVAN", "0300": "CLARE", "0400": "CORK", "0500": "CORK",
    "0600": "DONEGAL", "0700": "DUBLIN", "0800": "DUBLIN", "0900": "DUBLIN", "1000": "DUBLIN",
    "1100": "GALWAY", "1200": "GALWAY", "1300": "KERRY", "1400": "KILDARE", "1500": "KILKENNY",
    "1600": "LAOIS", "1700": "LEITRIM", "1800": "LIMERICK", "1900": "LIMERICK", "2000": "LONGFORD",
    "2100": "LOUTH", "2200": "MAYO", "2300": "MEATH", "2400": "MONAGHAN", "2500": "OFFALY",
    "2600": "ROSCOMMON", "2700": "SLIGO", "2800": "TIPPERARY", "2900": "TIPPERARY",
    "3000": "WATERFORD", "3100": "WATERFORD", "3200": "WESTMEATH", "3300": "WEXFORD", "3400": "WICKLOW",
}


def county_of_wsa(name):
    n = name.upper().strip()
    for k in ("DUBLIN", "FINGAL", "DUN LAOGHAIRE", "DÚN LAOGHAIRE"):
        if k in n:
            return "DUBLIN"
    for c in set(LA_PREFIX.values()):
        if c in n:
            return c
    return None


def num(cell):
    """'8 590 -' -> -8590 ; '1 9 61' -> 1961 ; '-' -> 0."""
    s = cell.replace("\u00a0", " ").strip()
    neg = s.endswith("-")
    s = s.rstrip("-").replace(" ", "").replace(",", "")
    if not s:
        return 0.0
    v = float(s)
    return -v if neg else v


def cells(line):
    return [c for c in re.split(r"\s{2,}", line.strip()) if c]


def parse_page(text):
    m = re.search(r"WRZ CODE\s+(\S+)\s+WRZ Name\s+(.+?)\s+Study Area", text, re.S)
    if not m:
        return None
    wrz = {"code": m.group(1), "name": " ".join(m.group(2).split())}
    for key, label in (("domestic", "Domestic Demand"), ("nonDomestic", "Non-Domestic Demand"),
                       ("leakage", "Leakage \\(m³/day\\)"), ("demand", "\nDemand \\(m³/day\\)")):
        mm = re.search(label + r"(?:\s*\n?\(m³/day\))?\s+([\d ]+)", text)
        wrz[key] = num(mm.group(1)) if mm else None
    # Two year-tables: the first is demand (avg, headroom, NYAA, DYAA, DYCP, WCP); the second is
    # WAFU (NYAA, DYAA, DYCP, WCP) then SDB (NYAA, DYAA, DYCP, WCP).
    rows = [l for l in text.split("\n") if re.match(r"^(2019|2025|2030|2035|2040|2044) ", l.strip())]
    tables = []
    for l in rows:
        l = l.strip()
        year = int(l[:4])
        vals = [num(c) for c in cells(l[5:])]
        tables.append((year, vals))
    demand = {y: v for y, v in tables[:6]}
    supply = {y: v for y, v in tables[6:12]}
    if len(demand) < 6 or len(supply) < 6:
        return None
    wrz["dycpDemand"] = {y: demand[y][4] for y in YEARS}
    wrz["avgDemand"] = {y: demand[y][0] for y in YEARS}
    wrz["dycpWafu"] = {y: supply[y][2] for y in YEARS}
    wrz["dycpSdb"] = {y: supply[y][6] for y in YEARS}
    return wrz


# The Greater Dublin Area page (Appendix L, page 554) is an image with no text layer. These
# figures were transcribed from it and check out: WAFU − (demand + headroom) = SDB.
GDA = {
    "code": "GDA", "name": "Greater Dublin Area",
    "domestic": 206866, "nonDomestic": 139309, "leakage": 214829, "demand": 572416,
    "dycpDemand": {2019: 696691, 2025: 733822, 2030: 737797, 2035: 733340, 2040: 755650, 2044: 773873},
    "avgDemand": {2019: 572416, 2025: 602079, 2030: 604626, 2035: 600256, 2040: 617885, 2044: 632292},
    "dycpWafu": {2019: 564501, 2025: 589501, 2030: 583501, 2035: 581501, 2040: 580501, 2044: 579501},
    "dycpSdb": {2019: -132190, 2025: -144322, 2030: -154296, 2035: -151839, 2040: -175150, 2044: -194373},
}


def main(pdf, xlsx, out):
    reader = PdfReader(pdf)
    wrzs, failed = {}, []
    for i, page in enumerate(reader.pages):
        t = page.extract_text() or ""
        if "WRZ CODE" not in t:
            continue
        try:
            w = parse_page(t)
        except ValueError:
            w = None  # a table whose columns can't be separated reliably
        if w:
            wrzs[w["code"]] = w
        else:
            failed.append(i)

    wrzs["GDA"] = GDA

    # Sanity check: SDB should equal WAFU − demand(+headroom) under DYCP.
    bad = [c for c, w in wrzs.items()
           if abs(w["dycpWafu"][2019] - w["dycpDemand"][2019] - w["dycpSdb"][2019]) > max(5, 0.02 * w["dycpDemand"][2019])]

    pop_by_wrz = defaultdict(lambda: defaultdict(float))
    wb = openpyxl.load_workbook(xlsx, read_only=True)
    for row in list(wb.worksheets[0].iter_rows(values_only=True))[1:]:
        wsa, _, _, _, wrz_code, _, pop = row[:7]
        c = county_of_wsa(str(wsa or ""))
        if c and wrz_code and isinstance(pop, (int, float)):
            pop_by_wrz[str(wrz_code).strip()][c] += pop

    agg = defaultdict(lambda: defaultdict(float))
    for code, w in wrzs.items():
        shares = pop_by_wrz.get(code)
        if shares and sum(shares.values()) > 0:
            tot = sum(shares.values())
            split = {c: p / tot for c, p in shares.items()}
        else:
            c = LA_PREFIX.get(code[:4])
            if not c:
                continue
            split = {c: 1.0}
        for c, f in split.items():
            a = agg[c]
            a["wrzCount"] += f
            if code == "GDA":
                a["gdaDemandShare"] += f
            a["popServed"] += f * sum((shares or {c: 0}).values()) if shares else 0
            a["demand2019"] += f * (w["demand"] or 0)
            a["leakage2019"] += f * (w["leakage"] or 0)
            for y in (2019, 2044):
                a[f"dycpDemand{y}"] += f * w["dycpDemand"][y]
                a[f"dycpWafu{y}"] += f * w["dycpWafu"][y]
                sdb = w["dycpSdb"][y]
                if sdb < 0:
                    a[f"dycpDeficit{y}"] += f * -sdb
                    a[f"deficitZoneDemand{y}"] += f * w["dycpDemand"][y]
                    a[f"deficitZoneWafu{y}"] += f * w["dycpWafu"][y]
                    if y == 2019:
                        a["popInDeficit2019"] += f * sum((shares or {}).values())

    counties = {c: {k: round(v, 4 if k.endswith("Share") else 1) for k, v in sorted(d.items())} for c, d in sorted(agg.items())}
    doc = {
        "source": "Uisce Éireann National Water Resources Plan – Framework Plan, Appendix L Supply Demand "
                  "Balance Summaries (2021); Uisce Éireann Public Water Supply Zone Information (Q1 2026)",
        "units": "m³/day; DYCP = Dry Year Critical Period (demand includes headroom)",
        "wrzParsed": len(wrzs),
        "wrzSdbCheckFailed": bad,
        "pagesFailed": failed,
        "counties": counties,
    }
    with open(out, "w") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"parsed {len(wrzs)} WRZs ({len(failed)} pages failed, {len(bad)} SDB check mismatches); wrote {out}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
