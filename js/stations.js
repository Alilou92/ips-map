// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Affiche popups + tooltips: Nom + (Genre + Ligne) avec couleur de ligne

import { distanceMeters } from "./util.js";

// Bump la version quand tu régénères data/stations.min.json pour casser le cache
const DATA_VERSION = "7"; // <- incrémente au besoin

// ──────────────────────────────────────────────────────────────
// Libellés & couleurs
// ──────────────────────────────────────────────────────────────

const MODE_LABEL = {
  metro: "Métro",
  rer: "RER",
  transilien: "Transilien",
  ter: "TER / Intercités",
  tgv: "TGV",
  tram: "Tram",
};

// Couleurs officielles (approchées) par ligne
const METRO_COLORS = {
  "1":"#FFCD00","2":"#1D87C9","3":"#9FCE66","3BIS":"#84C28E","4":"#A0006E",
  "5":"#F28E00","6":"#76C696","7":"#F59CB2","7BIS":"#89C8C5","8":"#CE64A6",
  "9":"#B0BD00","10":"#D6C178","11":"#704B1C","12":"#007852","13":"#99B4CB","14":"#662483"
};
const RER_COLORS = { A:"#E11E2B", B:"#0072BC", C:"#F6A800", D:"#2E7D32", E:"#8E44AD" };
const TRAM_COLORS = {
  T1:"#6F6F6F",T2:"#0096D7",T3:"#C77DB3","T3A":"#C77DB3","T3B":"#C77DB3",T4:"#5BC2E7",
  T5:"#A9CC51",T6:"#00A36D",T7:"#E98300",T8:"#B1B3B3",T9:"#C1002A",
  T10:"#6E4C9A",T11:"#575756",T12:"#0077C8",T13:"#008D36"
};
const TRANSILIEN_COLORS = { H:"#0064B0", J:"#9D2763", L:"#5C4E9B", N:"#00936E", P:"#E2001A", U:"#6F2C91", K:"#2E3192", R:"#00A4A7" };

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function modeKey(m) {
  const s = String(m || "").toLowerCase().trim();
  if (!s) return null;
  if (s.startsWith("met")) return "metro";
  if (s === "rer" || s.includes(" rer")) return "rer";
  if (s.startsWith("tram") || /^t\d/i.test(s)) return "tram";
  if (s.includes("transilien")) return "transilien";
  if (s.includes("interc") /* Intercités */) return "ter"; // regroupe Intercités avec TER
  if (s === "ter" || s.includes("ter ")) return "ter";
  if (s.includes("tgv") || s.includes("inoui") || s.includes("lyria")) return "tgv";
  if (s.includes("train") && !s.includes("rer")) return "transilien";
  return null;
}

// Essaie de déduire un code ligne depuis un texte brut (fallback si le JSON ne l'a pas déjà)
function normalizeLine(raw, mode) {
  const S = String(raw || "").toUpperCase();
  if (!S) return null;

  // RER A..E
  let m = S.match(/\bRER[\s-]*([A-E])\b/);
  if (m) return m[1];

  if (mode === "metro") {
    // 3 BIS / 7 BIS
    m = S.match(/\b(3|7)\s*BIS\b/);
    if (m) return `${m[1]}BIS`;
    // "LIGNE 8" / "M8" / "METRO 10" / "10"
    m = S.match(/\b(?:LIGNE|METRO|MÉTRO|M)\s*([0-9]{1,2})\b/);
    if (m) return m[1].replace(/^0+/,"");
    m = S.match(/\b([0-9]{1,2})\b/);
    if (m) return m[1].replace(/^0+/,"");
  }

  if (mode === "tram") {
    // "T9" / "Tram 9" / "T3A"
    m = S.match(/\bT\s*([0-9]{1,2}[AB]?)\b/);
    if (m) return `T${m[1].toUpperCase()}`;
    m = S.match(/\bTRAM\s*([0-9]{1,2}[AB]?)\b/);
    if (m) return `T${m[1].toUpperCase()}`;
  }

  if (mode === "transilien") {
    // H / J / L / N / P / U / K / R
    m = S.match(/\bTRANSILIEN\s+([A-Z]{1,2}\d?)\b/);
    if (m) return m[1];
    m = S.match(/\b([HJKLNPRU])\b/);
    if (m) return m[1];
  }

  // dernier recours : un identifiant court
  m = S.match(/\b([A-Z]{1,2}\d?)\b/);
  if (m) return m[1];
  m = S.match(/\b([0-9]{1,2})\b/);
  if (m) return m[1];

  return null;
}

function colorFor(mode, line) {
  const m = String(mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();

  if (m === "metro") {
    let key = l.replace(/^0+/,"").toUpperCase();
    if (key === "3 BIS") key = "3BIS";
    if (key === "7 BIS") key = "7BIS";
    return METRO_COLORS[key] || "#666";
  }
  if (m === "rer")   return RER_COLORS[l] || "#666";
  if (m === "tram")  return TRAM_COLORS[l.startsWith("T") ? l : ("T"+l)] || "#666";
  if (m === "transilien") return TRANSILIEN_COLORS[l] || "#666";
  // TER / TGV / Intercités (pas de couleurs officielles par ligne)
  return "#666";
}

function badgeText(mode, line) {
  const m = String(mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();
  if (m === "metro") return l || "M";
  if (m === "rer") return `RER ${l || ""}`.trim();
  if (m === "tram") return l || "T";
  if (m === "transilien") return l || "TN";
  return (MODE_LABEL[m] || m || "?").toUpperCase();
}

// Marker HTML (pastille ronde colorée)
function iconFor(mode, line) {
  const color = colorFor(mode, line);
  const html = `
    <div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};
      border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.35);
    "></div>`;
  return L.divIcon({
    className: "stn",
    html,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// Tooltip “inline badge”
function tooltipHtml(row) {
  const color = colorFor(row.mode, row.line);
  const btxt  = badgeText(row.mode, row.line);
  const mode  = MODE_LABEL[row.mode] || (row.mode || "").toUpperCase();

  let suffix = "";
  if (row.mode === "metro" && row.line)      suffix = ` — Ligne ${row.line}`;
  else if (row.mode === "rer" && row.line)   suffix = ` — RER ${row.line}`;
  else if (row.mode === "tram" && row.line)  suffix = ` — Tram ${row.line.replace(/^T/i,"")}`;
  else if (row.line)                         suffix = ` — ${row.line}`;

  return `
    <div style="display:flex;align-items:center;gap:.5rem;line-height:1.2;">
      <span style="
        display:inline-block;min-width:1.8em;padding:.1em .45em;border-radius:1em;
        background:${color};color:#fff;font-weight:700;font-size:.85em;text-align:center;
      ">${esc(btxt)}</span>
      <span style="font-weight:600">${esc(row.name)}</span>
      <span style="opacity:.85">${esc(suffix)}</span>
    </div>
  `;
}

function popupHtml(row) {
  const mode = MODE_LABEL[row.mode] || (row.mode || "").toUpperCase();
  let linePart = "";
  if (row.mode === "metro" && row.line)      linePart = `Ligne ${row.line}`;
  else if (row.mode === "rer" && row.line)   linePart = `RER ${row.line}`;
  else if (row.mode === "tram" && row.line)  linePart = `Tram ${row.line.replace(/^T/i,"")}`;
  else if (row.line)                         linePart = row.line;

  return `
    <div>
      <div style="font-weight:700;margin-bottom:.25rem">${esc(row.name)}${linePart ? " — " + esc(linePart) : ""}</div>
      <div style="opacity:.85">${esc(mode)}</div>
    </div>
  `;
}

/* -------- data loader (once) -------- */
let _loaded = null;

function pick(...candidates){
  for (const k of candidates){
    if (k != null && k !== undefined && String(k).trim() !== "") return k;
  }
  return null;
}

async function loadOnce() {
  if (_loaded) return _loaded;

  const ver = (window.APP_VERSION ? `${DATA_VERSION}-${window.APP_VERSION}` : DATA_VERSION);
  const urls = [
    `./data/stations.min.json?v=${ver}`,
    `./data/stations.min.json?ts=${Date.now()}`, // hard bypass si cache tenace
    `./data/stations.min.json`,
  ];

  let rows = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const raw = await res.json();
      rows = Array.isArray(raw) ? raw : [];
      if (rows.length) {
        console.debug(`[Stations] chargées: ${rows.length} (via ${url})`);
        break;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[Stations] fetch error:", e);
    }
  }

  // Normalisation robuste (accepte anciens et nouveaux schémas)
  const out = [];
  for (const r of rows) {
    const modeRaw = pick(r.mode, r.reseau, r.transport, r.mode_principal, r.service, r.category, r.type_service);
    const mode = modeKey(modeRaw);

    // nom
    const name = String(pick(r.name, r.nom, r.label, r.libelle, r.station, r.stop_name, "Gare")).trim();

    // type (Station pour métro/tram sinon Gare)
    const type = String(pick(
      r.type,
      r.typologie,
      (mode === "metro" || mode === "tram") ? "Station" : "Gare"
    )).trim();

    // coords
    const lat = Number(pick(r.lat, r.latitude, r.lat_wgs84, r.lat_w84, r.y));
    const lon = Number(pick(r.lon, r.longitude, r.lon_wgs84, r.lon_w84, r.x));

    // ligne / code de ligne
    const lineRaw = pick(r.line, r.ligne, r.code_ligne, r.code, r.nom_ligne, r.ligne_long, r.route_short_name);
    const line = normalizeLine(lineRaw, mode);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !mode) continue;
    out.push({ name, type, mode, line, lat, lon });
  }

  _loaded = out;
  console.debug(`[Stations] prêtes: ${_loaded.length}`);
  return _loaded;
}

/* -------- factory -------- */
export function makeStationsController({ map } = {}) {
  const _map = map || null;

  const groups = {
    metro: L.layerGroup(),
    rer: L.layerGroup(),
    transilien: L.layerGroup(),
    ter: L.layerGroup(),
    tgv: L.layerGroup(),
    tram: L.layerGroup(),
  };
  let allStations = [];

  function clearGroups() {
    for (const k of Object.keys(groups)) {
      groups[k].clearLayers();
      if (_map && _map.hasLayer(groups[k])) {
        _map.removeLayer(groups[k]);
      }
    }
  }

  function addMarkersFor({ modesWanted, center, radiusMeters } = {}) {
    const wanted = modesWanted instanceof Set
      ? modesWanted
      : new Set(["metro", "rer", "transilien", "ter", "tgv", "tram"]);

    clearGroups();

    const useRadius = Array.isArray(center)
      && Number.isFinite(radiusMeters) && radiusMeters > 0;

    for (const row of allStations) {
      if (!wanted.has(row.mode)) continue;

      if (useRadius) {
        const d = distanceMeters(center[0], center[1], row.lat, row.lon);
        if (d > radiusMeters) continue;
      }

      const mk = L.marker([row.lat, row.lon], { icon: iconFor(row.mode, row.line) });
      mk.bindTooltip(tooltipHtml(row), { sticky: true, direction: "top" });
      mk.bindPopup(popupHtml(row));
      groups[row.mode].addLayer(mk);
    }

    if (_map) {
      for (const m of Object.keys(groups)) {
        if (wanted.has(m) && groups[m].getLayers().length > 0) {
          groups[m].addTo(_map);
        }
      }
    }
  }

  return {
    async ensure({ modesWanted, center, radiusMeters } = {}) {
      if (!allStations.length) {
        allStations = await loadOnce(); // peut être vide si pas de fichier
      }
      addMarkersFor({ modesWanted, center, radiusMeters });
    },
    refresh({ modesWanted, center, radiusMeters } = {}) {
      addMarkersFor({ modesWanted, center, radiusMeters });
    },
    clear() {
      clearGroups();
    },
  };
}

export default makeStationsController;
