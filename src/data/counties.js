// County profiles for the 26 counties of Ireland.
//
// Keys match the COUNTY field of the Tailte Éireann "Counties – National Statutory
// Boundaries – Generalised 20m" feature service, so they join directly to the map layer.
//
// pop        – Census 2022 population (CSO, rounded)
// region     – broad region, for labels (climate signals come from TRANSLATE per county)
// coast      – coastal flood exposure index (0 = inland)
// river      – fluvial / pluvial flood exposure index
// water      – public water-supply stress index (east of Ireland is tightest)
// urban      – urban heat exposure index
// rsl        – extra relative sea-level change from vertical land motion, mm/yr
//              (north slightly rising → negative; south slightly sinking → positive)
// note       – what is at stake, for the briefing text
//
// The exposure indices are game-design judgements informed by OPW CFRAM flood maps,
// Uisce Éireann's National Water Resources Plan and Census urban populations. They are
// not official figures.

export const REGIONS = {
  east: { label: "East" },
  southeast: { label: "South-east" },
  midlands: { label: "Midlands" },
  southwest: { label: "South-west" },
  west: { label: "West & north-west" },
};

const C = (name, pop, region, coast, river, water, urban, rsl, note) => ({
  id: name.toUpperCase(),
  name,
  pop,
  region,
  coast,
  river,
  water,
  urban,
  rsl,
  note,
});

export const COUNTY_LIST = [
  C("Dublin", 1458154, "east", 0.8, 0.6, 1.0, 1.0, 0.1, "Dublin Bay quays and Docklands, the Dodder and Tolka, and a water supply with almost no spare headroom."),
  C("Cork", 584156, "southwest", 0.9, 0.8, 0.5, 0.6, 0.3, "Cork city's tidal quays on the Lee, Midleton and Bandon, and a busy harbour."),
  C("Galway", 277737, "west", 0.7, 0.6, 0.4, 0.45, 0.0, "Galway city's Claddagh and Docks, plus turlough flooding in south Galway."),
  C("Kildare", 247774, "east", 0, 0.4, 0.8, 0.5, 0, "Fast-growing commuter towns relying on the Liffey and the Greater Dublin supply."),
  C("Meath", 220826, "east", 0.15, 0.4, 0.75, 0.4, 0.1, "Boyne towns, a short coastline at Laytown, and the stretched eastern water supply."),
  C("Limerick", 209536, "southwest", 0.5, 0.8, 0.4, 0.55, 0.2, "Limerick city at the head of the Shannon estuary, exposed to tide and river."),
  C("Tipperary", 167895, "midlands", 0, 0.6, 0.35, 0.3, 0, "Clonmel and Carrick-on-Suir on the Suir, and Shannon-side farmland."),
  C("Donegal", 167084, "west", 0.6, 0.4, 0.25, 0.25, -0.3, "Long Atlantic coastline, eroding dunes, and harbour towns."),
  C("Wexford", 163919, "southeast", 0.7, 0.6, 0.5, 0.3, 0.3, "Wexford town's quays, a soft eroding coastline, and Enniscorthy on the Slaney."),
  C("Kerry", 156458, "southwest", 0.7, 0.5, 0.25, 0.3, 0.3, "Tralee and Killarney, exposed Atlantic peninsulas, and tourism infrastructure."),
  C("Wicklow", 155851, "east", 0.5, 0.45, 0.7, 0.4, 0.2, "Bray and Arklow on an eroding east coast, and Vartry and Poulaphouca reservoirs."),
  C("Louth", 139703, "east", 0.55, 0.4, 0.6, 0.5, 0.0, "Drogheda and Dundalk on low-lying estuaries."),
  C("Mayo", 137970, "west", 0.5, 0.5, 0.25, 0.25, -0.1, "Westport and Ballina, Atlantic storms and the Moy catchment."),
  C("Clare", 127938, "southwest", 0.6, 0.7, 0.3, 0.3, 0.1, "Ennis on the Fergus, the Shannon estuary, and storm-battered Lahinch."),
  C("Waterford", 127363, "southeast", 0.65, 0.5, 0.4, 0.45, 0.3, "Waterford city's Suir quays and the Copper Coast."),
  C("Kilkenny", 104160, "southeast", 0, 0.6, 0.45, 0.3, 0, "Kilkenny city on the Nore and the Barrow valley."),
  C("Westmeath", 96221, "midlands", 0, 0.8, 0.35, 0.35, 0, "Athlone on the Shannon, with long-duration winter flooding."),
  C("Laois", 91877, "midlands", 0, 0.45, 0.45, 0.3, 0, "Portlaoise and the upper Barrow and Nore."),
  C("Offaly", 83150, "midlands", 0, 0.75, 0.35, 0.25, 0, "Shannon Callows and Clonmacnoise, with prolonged flooding of farmland."),
  C("Cavan", 81704, "midlands", 0, 0.55, 0.3, 0.2, 0, "Erne lakelands and drumlin flooding."),
  C("Sligo", 70198, "west", 0.55, 0.4, 0.3, 0.35, -0.2, "Sligo town's Garavogue quays and the Atlantic surf coast."),
  C("Roscommon", 70259, "midlands", 0, 0.75, 0.3, 0.2, 0, "Shannon and Suck callows, and groundwater-flooded turloughs."),
  C("Monaghan", 65288, "midlands", 0, 0.35, 0.35, 0.25, 0, "Small lakes, intensive agriculture, and a local water supply."),
  C("Carlow", 61968, "southeast", 0, 0.65, 0.45, 0.35, 0, "Carlow town and Bagenalstown on the Barrow."),
  C("Longford", 46751, "midlands", 0, 0.6, 0.3, 0.25, 0, "Lough Ree, the Camlin, and Shannon flooding."),
  C("Leitrim", 35199, "west", 0, 0.65, 0.2, 0.15, 0, "Carrick-on-Shannon and the upper Shannon lakes."),
];

export const COUNTIES = Object.fromEntries(COUNTY_LIST.map((c) => [c.id, c]));

// Baseline expected annual damage (EAD) per hazard, in €M per year at present-day
// climate with today's defences. Every capital cost in the game scales from these,
// so the game stays balanced whether you play Dublin or Leitrim.
export function baseEAD(county) {
  const p = county.pop / 1e5;
  return {
    coastal: county.coast > 0 ? +(county.coast * p * 2.5).toFixed(2) : 0,
    fluvial: +(county.river * p * 2 + county.river * 1.5).toFixed(2),
    heat: +(county.urban * p * 0.8 + 0.3).toFixed(2),
    water: +(county.water * county.water * p * 2.5 + 0.2).toFixed(2),
  };
}

export function titleCase(s) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
