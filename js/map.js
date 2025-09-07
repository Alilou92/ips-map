// js/map.js — Leaflet helpers (fond HTTPS + utilitaires)
import { round1 } from "./util.js?v=3";

/* ---------- fond de carte ---------- */
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* ---------- icônes et couleurs ---------- */
function colorForIps(ips) {
  if (!Number.isFinite(ips)) return "#9aa2ad";   // gris si IPS inconnu
  if (ips < 90)  return "#ef4444";               // rouge
  if (ips <= 110) return "#f59e0b";              // orange
  return "#10b981";                               // vert
}

function makeDot(color, size = 16, whiteRing = true) {
  const ring = whiteRing ? 'border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);' : '';
  const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;
                 background:${color};${ring}"></div>`;
  return L.divIcon({ className: "pin", html, iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

/* ---------- exports ---------- */
export function initMap() {
  const map = L.map("map", {
    center: [48.8566, 2.3522],
    zoom: 12,
    zoomControl: true,
    preferCanvas: true
  });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTR,
    maxZoom: 19,
    crossOrigin: true
  }).addTo(map);

  // couche unique pour les markers des établissements
  const markersLayer = L.layerGroup().addTo(map);

  return { map, markersLayer };
}

export function drawAddressCircle(map, lat, lon, radiusMeters) {
  const circle = L.circle([lat, lon], {
    radius: radiusMeters,
    color: "#60a5fa",
    weight: 2,
    fillColor: "#93c5fd",
    fillOpacity: 0.15
  }).addTo(map);
  return circle;
}

export function markerFor(f, ipsMap) {
  // f = { lat, lon, uai, type, name, commune, secteur }
  const ips = ipsMap instanceof Map ? ipsMap.get(String(f.uai || "").toUpperCase()) : undefined;
  const col = colorForIps(ips);
  const icon = makeDot(col, 16);

  const m = L.marker([f.lat, f.lon], { icon });

  const typeHuman = f.type === "ecole" ? "École"
                   : f.type === "college" ? "Collège"
                   : f.type === "lycee" ? "Lycée" : "Établissement";

  const ipsTxt = Number.isFinite(ips) ? round1(ips).toFixed(1) : "—";
  const sec = f.secteur ?? "—";
  const commune = f.commune ? ` — ${f.commune}` : "";

  m.bindPopup(
    `<div style="line-height:1.35">
      <div style="font-weight:700;margin-bottom:.25rem">${typeHuman}${commune}</div>
      <div>${(f.name ?? "").toString()}</div>
      <div style="opacity:.85">IPS : <strong>${ipsTxt}</strong> • Secteur : ${sec} • UAI : ${f.uai ?? "—"}</div>
    </div>`
  );

  return m;
}

export function fitToMarkers(map, items) {
  const coords = (items || [])
    .map(x => (Array.isArray(x) ? x : [x.lat, x.lon]))
    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!coords.length) return;
  const b = L.latLngBounds(coords.map(([la, lo]) => L.latLng(la, lo)));
  try { map.fitBounds(b.pad(0.15), { animate: true }); } catch {}
}

export default { initMap, drawAddressCircle, markerFor, fitToMarkers };
