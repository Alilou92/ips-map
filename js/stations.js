// js/stations.js — contrôleur des gares/stations (IDFM + SNCF)
// Tooltips & popups, couleurs par ligne, nettoyage des noms.

import { distanceMeters } from "./util.js";

// Bump si tu changes data/stations.min.json
const DATA_VERSION = "9";

// ──────────────────────────────────────────────────────────────
// Libellés & couleurs
// ──────────────────────────────────────────────────────────────
const MODE_LABEL = {
  metro: "Métro",
  rer: "RER",
  transilien: "Transilien",
  ter: "TER",
  tgv: "TGV",
  tram: "Tram",
};

const METRO_COLORS = {
  "1":"#FFCD00","2":"#1D87C9","3":"#9FCE66","3BIS":"#84C28E","4":"#A0006E",
  "5":"#F28E00","6":"#76C696","7":"#F59CB2","7BIS":"#89C8C5","8":"#CE64A6",
  "9":"#B0BD00","10":"#D6C178","11":"#704B1C","12":"#007852","13":"#99B4CB","14":"#662483"
};
const RER_COLORS = { A:"#E11E2B", B:"#0072BC", C:"#F6A800", D:"#2E7D32", E:"#8E44AD" };
const TRAM_COLORS = { T1:"#6F6F6F",T2:"#0096D7",T3:"#C77DB3","T3A":"#C77DB3","T3B":"#C77DB3",T4:"#5BC2E7",T5:"#A9CC51",T6:"#00A36D",T7:"#E98300",T8:"#B1B3B3",T9:"#C1002A",T10:"#6E4C9A",T11:"#575756",T12:"#0077C8",T13:"#008D36" };
// Carte IDFM Transilien (teintes proches de l’official)
const TRANSILIEN_COLORS = { H:"#0064B0", J:"#9D2763", L:"#5C4E9B", N:"#00936E", P:"#E2001A", U:"#6F2C91", K:"#2E3192", R:"#00A4A7" };
// Teintes par défaut
const TER_COLOR = "#0A74DA";   // bleu TER
const TGV_COLOR = "#A1006B";   // magenta TGV

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

function cleanName(raw) {
  let s = String(raw || "").trim();
  if (!s) return "Gare";

  // supprime “Gare (SNCF) de …”, “Gare d’…”
  s = s.replace(/\bGare(?:\s+SNCF)?\s+(?:de|d’|d'|du|des)\s+/i, "");
  // supprime tag “Gare de” doublé
  s = s.replace(/^Gare\s+/i, "");
  // supprime parenthèses techniques
  s = s.replace(/\s*\((?:RER|SNCF|Transilien|Métro|Metro|Tram|IDFM)[^)]+\)\s*/ig, " ");
  // supprime “ - RER X” / “ – RER X”
  s = s.replace(/\s*[-–]\s*RER\s+[A-E]\b/ig, "");
  // supprime “ - Ligne X”
  s = s.replace(/\s*[-–]\s*Ligne\s+[A-Z0-9]+$/i, "");
  // espaces multiples
  s = s.replace(/\s{2,}/g, " ").trim();

  // évite vide
  return s || "Gare";
}

function modeKey(m) {
  const s = String(m || "").toLowerCase().trim();
  if (s.startsWith("met")) return "metro";
  if (s === "rer" || s.includes(" rer")) return "rer";
  if (s.includes("transilien") || s.includes("train")) return "transilien";
  if (s === "ter") return "ter";
  if (s === "tgv" || s.includes("lgv")) return "tgv";
  if (s.startsWith("tram") || /^t\d/i.test(s)) return "tram";
  return null;
}

function normalizeLine(raw, mode) {
  const S = String(raw || "").toUpperCase();
  if (!S) return null;

  // RER A..E
  let m = S.match(/\bRER\s*([A-E])\b/);
  if (m) return m[1];

  if (mode === "metro") {
    m = S.match(/(?:LIGNE|METRO|MÉTRO|M)\s*([0-9]{1,2})\b/);
    if (m) return m[1];
    m = S.match(/\b([0-9]{1,2})\b/);
    if (m) return m[1];
    // 3bis/7bis
    m = S.match(/\b([37])\s*BIS\b/);
    if (m) return (m[1] === "3" ? "3BIS" : "7BIS");
  }

  if (mode === "tram") {
    m = S.match(/\bT\s*([0-9]{1,2}[AB]?)\b/);
    if (m) return `T${m[1].toUpperCase()}`;
    m = S.match(/\bTRAM\s*([0-9]{1,2}[AB]?)\b/);
    if (m) return `T${m[1].toUpperCase()}`;
  }

  if (mode === "transilien") {
    // "Ligne J", "Transilien L", "J"
    m = S.match(/\b(?:LIGNE|TRANSILIEN)\s+([HJKLNRPU])\b/);
    if (m) return m[1];
    m = S.match(/\b([HJKLNRPU])\b/);
    if (m) return m[1];
  }

  // Fallbacks généraux
  m = S.match(/\b([A-Z]{1,2}\d?)\b/); if (m) return m[1];
  m = S.match(/\b([0-9]{1,2})\b/);   if (m) return m[1];
  return null;
}

function colorFor(mode, line) {
  const m = String(mode || "").toLowerCase();
  const l = String(line || "").toUpperCase();

  if (m === "metro")       return METRO_COLORS[l.replace(/^0+/,"")] || "#666";
  if (m === "rer")         return RER_COLORS[l] || "#666";
  if (m === "tram")        return TRAM_COLORS[l.startsWith("T") ? l : ("T"+l)] || "#666";
  if (m === "transilien")  return TRANSILIEN_COLORS[l] || "#2c8b2c";
  if (m === "ter")         return TER_COLOR;
  if (m === "tgv")         return TGV_COLOR;
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

function tooltipHtml(row) {
  const color = colorFor(row.mode, row.line);
  const btxt  = badgeText(row.mode, row.line);

  let suffix = "";
  if (row.mode === "metro" && row.line)      suffix = ` — Ligne ${row.line}`;
  else if (row.mode === "rer" && row.line)   suffix = ` — RER ${row.line}`;
  else if (row.mode === "tram" && row.line)  suffix = ` — Tram ${row.line.replace(/^T/i,"")}`;
  else if (row.mode === "transilien" && row.line) suffix = ` — Ligne ${row.line}`;
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
  else if (row.mode === "transilien" && row.line) linePart = `Ligne ${row.line}`;
  else if (row.line)                         linePart = row.line;

  return `
    <div>
      <div style="font-weight:700;margin-bottom:.25rem">${esc(row.name)}${linePart ? " — " + esc(linePart) : ""}</div>
      <div style="opacity:.85">${esc(mode)}</div>
    </div>
  `;
}

// ──────────────────────────────────────────────────────────────
// Chargement + normalisation
// ──────────────────────────────────────────────────────────────
let _loaded = null;

function firstNonEmpty(o, keys) {
  for (const k of keys) {
    const v = o?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

function guessModeFromContext(row, nameU, lineU) {
  // priorité : RER / Métro / Tram si mention claire
  if (/\bRER\s+[A-E]\b/.test(nameU) || /\bRER\b/.test(lineU)) return "rer";
  if (/\b(M|MÉTRO|METRO)\s*\d{1,2}\b/.test(nameU) || /\bLIGNE\s*\d{1,2}\b/.test(lineU)) return "metro";
  if (/\bT\d{1,2}[AB]?\b/.test(nameU) || /\bTRAM\b/.test(lineU)) return "tram";

  // SNCF : si UIC / code_ligne présent => réseau Transilien/TER/TGV
  const isSncf = ("uic" in row) || ("code_ligne" in row) || ("voyageurs" in row) || ("codeuic" in row);
  if (isSncf) {
    if (/\bTGV\b/.test(nameU)) return "tgv";
    if (/\bTER\b/.test(nameU)) return "ter";
    // par défaut, Transilien
    return "transilien";
  }
  return null;
}

function extractLine(row, mode, rawLine, nameU) {
  // Ligne depuis champs explicites
  let L = normalizeLine(rawLine, mode);
  if (L) return L;

  // Essais depuis le nom
  if (!L) {
    if (mode === "rer") {
      const m = nameU.match(/\bRER\s*([A-E])\b/); if (m) return m[1];
    } else if (mode === "metro") {
      let m = nameU.match(/\b(M|MÉTRO|METRO)\s*([0-9]{1,2})\b/); if (m) return m[2];
      m = nameU.match(/\b([37])\s*BIS\b/); if (m) return m[1] === "3" ? "3BIS" : "7BIS";
    } else if (mode === "tram") {
      const m = nameU.match(/\bT\s*([0-9]{1,2}[AB]?)\b/); if (m) return `T${m[1].toUpperCase()}`;
    } else if (mode === "transilien") {
      const m = nameU.match(/\b([HJKLNRPU])\b/); if (m) return m[1];
    }
  }
  return null;
}

async function loadOnce() {
  if (_loaded) return _loaded;

  const v = typeof window !== "undefined" ? (window.APP_VERSION || "") : "";
  const urls = [
    `./data/stations.min.json?v=${DATA_VERSION}-${v}`,
    `./data/stations.min.json?v=${DATA_VERSION}`,
    `./data/stations.min.json`,
  ];

  let rows = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      const raw = await res.json();
      rows = Array.isArray(raw) ? raw : [];
      if (rows.length) {
        console.debug(`[Stations] chargées: ${rows.length} (via ${url})`);
        break;
      }
    } catch {}
  }

  const out = [];
  for (const r of rows) {
    const lat = Number(firstNonEmpty(r, ["lat","latitude"]));
    const lon = Number(firstNonEmpty(r, ["lon","lng","longitude"]));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const rawName = firstNonEmpty(r, ["name","nom","libelle","label","intitule"]) || "Gare";
    const name = cleanName(rawName);

    const rawLine = firstNonEmpty(r, ["line","ligne","nom_ligne","code_ligne","ligne_long","code"]); // plusieurs variantes
    const lineU = String(rawLine || "").toUpperCase();

    // 1) si un mode explicite existe
    let mode = modeKey(firstNonEmpty(r, ["mode","reseau","transport","mode_principal"]));

    // 2) sinon, on devine via le contexte
    if (!mode) {
      const nameU = name.toUpperCase();
      mode = guessModeFromContext(r, nameU, lineU) || null;
    }

    if (!mode) continue; // sans mode fiable, ignorer

    // 3) Extrait/normalise la ligne
    const nameU = name.toUpperCase();
    const line = extractLine(r, mode, rawLine, nameU);

    out.push({ name, mode, line, lat, lon });
  }

  _loaded = out;
  console.debug(`[Stations] prêtes: ${_loaded.length}`);
  return _loaded;
}

// ──────────────────────────────────────────────────────────────
// Controller
// ──────────────────────────────────────────────────────────────
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
      : new Set(Object.keys(groups));

    // reset contenu (on conserve/retire calques après remplissage)
    for (const m of Object.keys(groups)) groups[m].clearLayers();

    const withRadius = Array.isArray(center)
      && Number.isFinite(radiusMeters) && radiusMeters > 0;

    for (const row of allStations) {
      if (!wanted.has(row.mode)) continue;

      if (withRadius) {
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
        const layer = groups[m];
        if (wanted.has(m) && layer.getLayers().length > 0) {
          if (!_map.hasLayer(layer)) layer.addTo(_map);
        } else if (_map.hasLayer(layer)) {
          _map.removeLayer(layer);
        }
      }
    }
  }

  return {
    async ensure({ modesWanted, center, radiusMeters } = {}) {
      if (!allStations.length) {
        allStations = await loadOnce();
      }
      addMarkersFor({ modesWanted, center, radiusMeters });
    },
    refresh({ modesWanted, center, radiusMeters } = {}) {
      addMarkersFor({ modesWanted, center, radiusMeters });
    },
    clear() { clearGroups(); },
  };
}

export default makeStationsController;
