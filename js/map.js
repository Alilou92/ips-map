export function initMap(){
  const map = L.map('map').setView([46.8, 2.5], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom: 19, attribution:'&copy; OpenStreetMap'
  }).addTo(map);
  const markersLayer = L.layerGroup().addTo(map);
  return { map, markersLayer };
}
function colorForIPS(ips){
  if (ips == null) return "#888888";
  if (ips < 90) return "#d7191c";
  if (ips <= 110) return "#fdae61";
  return "#1a9641";
}
export function markerFor(est, ipsMap){
  const ips = ipsMap.has(est.uai) ? ipsMap.get(est.uai) : null;
  const color = colorForIPS(ips);
  const icon = L.divIcon({
    className: "ips-marker",
    html: `<div style="width:14px;height:14px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 2px rgba(0,0,0,.4)"></div>`,
    iconSize: [14,14], iconAnchor: [7,7]
  });
  const sectBadge = `<span class="badge">${est.secteur}</span>`;
  const tLabel = (est.type==="ecole"?"École":est.type==="college"?"Collège":"Lycée");
  const ipsText = (ips!=null) ? `<strong>IPS :</strong> ${ips.toFixed(1)}` : `<em>IPS non publié</em>`;
  const popup = `
    <div>
      <div style="font-weight:600">${est.name} ${sectBadge}</div>
      <div>${tLabel} – ${est.nature || ""}</div>
      <div>${est.adresse || ""}${est.code_postal?" • "+est.code_postal:""} ${est.commune||""}</div>
      <div style="margin-top:6px">${ipsText}</div>
      <div style="margin-top:6px;font-size:12px;color:#666">UAI : ${est.uai}</div>
    </div>`;
  return L.marker([est.lat, est.lon], {icon}).bindPopup(popup);
}
export function drawAddressCircle(map, lat, lon, radiusMeters){
  const c = L.circle([lat,lon], {radius: radiusMeters, color:'#3b82f6'});
  c.addTo(map);
  map.setView([lat,lon], 15);
  return c;
}
export function fitToMarkers(map, items){
  if (!items.length) return;
  const g = L.featureGroup(items.map(f => L.marker([f.lat,f.lon])));
  map.fitBounds(g.getBounds().pad(0.2));
}
