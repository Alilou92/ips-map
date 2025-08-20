// js/map.js  (v=15)
export function initMap() {
  // Centre par défaut: Paris
  const map = L.map('map', {
    center: [48.8566, 2.3522],
    zoom: 12,
    zoomControl: true
  });

  // Tuiles OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> • ' +
      'Rendu via <a href="https://leafletjs.com/">Leaflet</a>'
  }).addTo(map);

  // Couche pour nos marqueurs
  const markersLayer = L.layerGroup().addTo(map);

  // Dans certains layouts flex, Leaflet a besoin d’un invalidateSize
  setTimeout(() => { try { map.invalidateSize(); } catch(e) {} }, 50);

  return { map, markersLayer };
}

export function drawAddressCircle(map, lat, lon, radiusMeters) {
  const circle = L.circle([lat, lon], {
    radius: radiusMeters,
    color: '#1976d2',
    weight: 2,
    opacity: 0.9,
    fillColor: '#42a5f5',
    fillOpacity: 0.08
  }).addTo(map);
  map.setView([lat, lon], radiusMeters <= 1200 ? 15 : 13);
  return circle;
}

function colorForIPS(ips) {
  if (ips == null || isNaN(ips)) return '#777';
  if (ips < 90) return '#d32f2f';
  if (ips <= 110) return '#f6b73c';
  return '#2e7d32';
}

function labelForType(t) {
  return t === 'ecole' ? 'École' : t === 'college' ? 'Collège' : t === 'lycee' ? 'Lycée' : 'Établissement';
}

export function markerFor(est, ipsMapOrValue) {
  const ips = ipsMapOrValue instanceof Map
    ? ipsMapOrValue.get(est.uai)
    : (typeof ipsMapOrValue === 'number' ? ipsMapOrValue : est.ips);

  const marker = L.circleMarker([est.lat, est.lon], {
    radius: 7,
    color: colorForIPS(ips),
    weight: 2,
    fillColor: colorForIPS(ips),
    fillOpacity: 0.85
  });

  const typeLabel = labelForType(est.type);
  const ipsTxt = ips == null || isNaN(ips) ? '<span style="color:#777">non publié</span>' : ips.toFixed(1);

  const html =
    `<div style="min-width:220px">
      <div style="font-weight:600">${est.name || 'Établissement'}</div>
      <div style="font-size:12px;opacity:.8">${typeLabel} — ${est.commune || ''}</div>
      <div style="margin-top:6px">IPS : <strong>${ipsTxt}</strong></div>
      ${est.uai ? `<div style="font-size:12px;opacity:.75">UAI : ${est.uai}</div>` : ''}
    </div>`;

  marker.bindPopup(html, { maxWidth: 280 });
  return marker;
}

export function fitToMarkers(map, items) {
  const pts = items
    .map(x => [Number(x.lat), Number(x.lon)])
    .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));

  if (!pts.length) return;
  const bounds = L.latLngBounds(pts);
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });
}
