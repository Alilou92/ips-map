// js/map.js — création de la carte + helpers de markers

/* Init de la carte + couche OSM en HTTPS */
export function initMap() {
  const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
    preferCanvas: false
  }).setView([48.846, 2.355], 13); // Paris par défaut

  // IMPORTANT : tuile OSM en HTTPS
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    subdomains: ["a", "b", "c"],
    maxZoom: 20,
    crossOrigin: true,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  return { map, markersLayer };
}

/* Cercle d'adresse (rayon en mètres) */
export function drawAddressCircle(map, lat, lon, radiusMeters) {
  const circle = L.circle([lat, lon], {
    radius: radiusMeters,
    color: "#3b82f6",
    weight: 2,
    fillColor: "#60a5fa",
    fillOpacity: 0.09
  }).addTo(map);
  return circle;
}

/* Marker établissement coloré selon l'IPS */
function colorForIPS(ips) {
  if (ips == null || !Number.isFinite(+ips)) return "#a3a3a3"; // gris = non publié
  const v = +ips;
  if (v < 90) return "#e11d48";      // défavorisé
  if (v <= 110) return "#f59e0b";    // moyen
  return "#16a34a";                  // favorisé
}

/* Marker pour un établissement (école/collège/lycée) */
export function markerFor(f, ipsMap /* Map(uai -> ips) */) {
  const ips = ipsMap instanceof Map ? ipsMap.get(f.uai) : f.ips;
  const color = colorForIPS(ips);

  const icon = L.divIcon({
    className: "sch",
    html: `<div style="width:18px;height:18px;border-radius:50%;
            background:${color};border:2px solid #fff;
            box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  const name = f.name || f.nom || f.etab || "Établissement";
  const type = f.type || f.categorie || "";
  const comm = f.commune || f.ville || "";

  const m = L.marker([f.lat, f.lon], { icon })
    .bindTooltip(`${name}`, { sticky: true, direction: "top" })
    .bindPopup(
      `<div style="font-weight:700">${name}</div>
       <div style="opacity:.85">${type}${comm ? " — " + comm : ""}</div>
       <div>IPS : ${ips != null ? Number(ips).toFixed(1) : "non publié"}</div>`
    );

  return m;
}

/* Fit carte aux éléments (items: {lat,lon}) */
export function fitToMarkers(map, items) {
  const pts = (items || []).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  if (!pts.length) return;
  const b = L.latLngBounds(pts.map(p => [p.lat, p.lon]));
  map.fitBounds(b.pad(0.08), { animate: true });
}
