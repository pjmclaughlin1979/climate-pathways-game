import { useEffect, useRef, useState } from "react";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import Map from "@arcgis/core/Map.js";
import Basemap from "@arcgis/core/Basemap.js";
import TileLayer from "@arcgis/core/layers/TileLayer.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import ClassBreaksRenderer from "@arcgis/core/renderers/ClassBreaksRenderer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import LabelClass from "@arcgis/core/layers/support/LabelClass.js";
import TextSymbol from "@arcgis/core/symbols/TextSymbol.js";
import PopupTemplate from "@arcgis/core/PopupTemplate.js";
import { COUNTIES, REGIONS, baseEAD } from "../data/counties.js";
import { SCENARIO_BY_ID } from "../data/climate.js";
import { MAP_VARIABLES, mapValue } from "../engine/selectors.js";

// Tailte Éireann (formerly OSi) county boundaries, generalised 20 m, © Tailte Éireann, CC BY 4.0.
const COUNTIES_URL =
  "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/ArcGIS/rest/services/Counties___OSi_National_Statutory_Boundaries___Generalised_20m/FeatureServer/0";
// Public, token-free Esri canvas tiles, so no API key or sign-in is needed.
const BASE_URL = "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer";
const REF_URL = "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Reference/MapServer";

function buildRenderer(variable, track, year) {
  const v = MAP_VARIABLES[variable];
  const sc = SCENARIO_BY_ID[track];
  const infos = v.colors.map((color, i) => {
    const lo = v.breaks[i];
    const hi = v.breaks[i + 1];
    const label =
      i === 0
        ? `< ${v.fmt(hi)}`
        : i === v.colors.length - 1
          ? `> ${v.fmt(lo)}`
          : `${v.fmt(lo)} to ${v.fmt(hi)}`;
    return {
      minValue: lo,
      maxValue: hi,
      label,
      symbol: new SimpleFillSymbol({ color, outline: { color: [255, 255, 255, 0.9], width: 0.7 } }),
    };
  });
  return new ClassBreaksRenderer({
    field: "value",
    legendOptions: { title: `${v.label} · ${sc.label} · ${year}` },
    classBreakInfos: infos,
    defaultSymbol: new SimpleFillSymbol({
      color: [230, 230, 230, 0.8],
      style: "diagonal-cross",
      outline: { color: [255, 255, 255, 0.9], width: 0.7 },
    }),
    defaultLabel: "Not applicable (inland)",
  });
}

export default function MapView({ variable, track, year, selectedCounty, onCountyClick }) {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const graphicsRef = useRef([]);
  const selRef = useRef(null);
  const settingsRef = useRef({ variable, track, year });
  const clickRef = useRef(onCountyClick);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  settingsRef.current = { variable, track, year };
  clickRef.current = onCountyClick;

  // One-time map setup
  useEffect(() => {
    const el = mapRef.current;
    let cancelled = false;
    let clickHandler;
    (async () => {
      try {
        el.map = new Map({
          basemap: new Basemap({
            baseLayers: [new TileLayer({ url: BASE_URL })],
            referenceLayers: [new TileLayer({ url: REF_URL, opacity: 0.8 })],
          }),
        });
        await el.viewOnReady();
        if (cancelled) return;
        el.view.constraints = { minZoom: 5, maxZoom: 12 };

        const src = new FeatureLayer({ url: COUNTIES_URL });
        const fs = await src.queryFeatures({
          where: "1=1",
          outFields: ["COUNTY", "CONTAE", "PROVINCE"],
          returnGeometry: true,
          outSpatialReference: el.view.spatialReference,
          maxAllowableOffset: 250,
        });
        if (cancelled) return;
        const { variable: v, track: t, year: y } = settingsRef.current;
        const graphics = fs.features.map(
          (f, i) =>
            new Graphic({
              geometry: f.geometry,
              attributes: {
                oid: i + 1,
                county: f.attributes.COUNTY,
                name: COUNTIES[f.attributes.COUNTY]?.name ?? f.attributes.COUNTY,
                irish: f.attributes.CONTAE,
                province: f.attributes.PROVINCE,
                value: mapValue(f.attributes.COUNTY, v, t, y),
              },
            })
        );
        graphicsRef.current = graphics;

        const layer = new FeatureLayer({
          title: "Climate projections by county",
          source: graphics,
          objectIdField: "oid",
          geometryType: "polygon",
          spatialReference: el.view.spatialReference,
          fields: [
            { name: "oid", type: "oid" },
            { name: "county", type: "string" },
            { name: "name", type: "string" },
            { name: "irish", type: "string" },
            { name: "province", type: "string" },
            { name: "value", type: "double" },
          ],
          outFields: ["*"],
          renderer: buildRenderer(v, t, y),
          labelingInfo: [
            new LabelClass({
              labelExpressionInfo: { expression: "$feature.name" },
              symbol: new TextSymbol({
                color: "#22313f",
                haloColor: "white",
                haloSize: 1.2,
                font: { size: 9, family: "Avenir Next LT Pro", weight: "bold" },
              }),
              minScale: 6e6,
            }),
          ],
          popupTemplate: new PopupTemplate({
            title: "{name} · {irish}",
            outFields: ["*"],
            content: (e) => popupHtml(e.graphic.attributes.county, settingsRef.current),
          }),
        });
        layerRef.current = layer;
        const sel = new GraphicsLayer({ title: "Your county", listMode: "hide" });
        selRef.current = sel;
        el.map.addMany([layer, sel]);

        clickHandler = async (evt) => {
          const res = await el.hitTest(evt.detail, { include: layer });
          const hit = res.results.find((r) => r.graphic?.layer === layer);
          if (hit) clickRef.current?.(hit.graphic.attributes.county);
        };
        el.addEventListener("arcgisViewClick", clickHandler);
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(err?.message || String(err));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (clickHandler) el.removeEventListener("arcgisViewClick", clickHandler);
    };
  }, []);

  // Re-symbolise when the explored variable, scenario or year changes
  useEffect(() => {
    const layer = layerRef.current;
    if (status !== "ready" || !layer) return;
    const updates = graphicsRef.current.map((g) => {
      g.attributes = { ...g.attributes, value: mapValue(g.attributes.county, variable, track, year) };
      return g;
    });
    layer.renderer = buildRenderer(variable, track, year);
    layer.applyEdits({ updateFeatures: updates }).catch((e) => console.error(e));
    const view = mapRef.current?.view;
    if (view?.popup?.visible) view.closePopup();
  }, [variable, track, year, status]);

  // Highlight the player's county
  useEffect(() => {
    const sel = selRef.current;
    if (status !== "ready" || !sel) return;
    sel.removeAll();
    mapRef.current?.view?.closePopup();
    const g = graphicsRef.current.find((x) => x.attributes.county === selectedCounty);
    if (!g) return;
    sel.add(
      new Graphic({
        geometry: g.geometry,
        symbol: new SimpleFillSymbol({
          color: [0, 0, 0, 0],
          outline: { color: [29, 53, 87, 1], width: 3.2 },
        }),
      })
    );
  }, [selectedCounty, status]);

  return (
    <div className="map-wrap">
      <arcgis-map ref={mapRef} center="-8.1,53.45" zoom="7">
        <arcgis-zoom slot="top-right" />
        <arcgis-home slot="top-right" />
        {/* A plain slotted legend stays inside the map's stacking context, so modals cover it. */}
        <arcgis-legend slot="bottom-right" style={{ maxHeight: "45vh", maxWidth: "260px" }} />
      </arcgis-map>
      {status === "loading" && <div className="map-status">Loading county boundaries…</div>}
      {status === "error" && <div className="map-status error">The map couldn't load: {error}</div>}
    </div>
  );
}

function popupHtml(countyId, { track, year }) {
  const c = COUNTIES[countyId];
  if (!c) return "";
  const sc = SCENARIO_BY_ID[track];
  const rows = Object.entries(MAP_VARIABLES)
    .map(([k, v]) => {
      const val = mapValue(countyId, k, track, year);
      return `<tr><th>${v.short}</th><td>${val == null ? "n/a" : v.fmt(val)}</td></tr>`;
    })
    .join("");
  const b = baseEAD(c);
  const div = document.createElement("div");
  div.className = "popup";
  div.innerHTML = `
    <p class="popup-sub">${REGIONS[c.region].label} · population ${c.pop.toLocaleString("en-IE")}</p>
    <p>${c.note}</p>
    <p class="popup-sub"><b>${sc.label}</b> (${sc.name}), ${year}</p>
    <table class="popup-table">${rows}</table>
    <p class="popup-sub">Today's expected annual damage: coastal €${b.coastal}M · river €${b.fluvial}M · heat €${b.heat}M · water €${b.water}M</p>`;
  return div;
}
