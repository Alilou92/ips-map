import { colorForIPS } from "./util.js";

export function initMap(){
  const map = L.map('map', { zoomControl: true }).setView([48.8566, 2.3522], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  const markersLayer = L.layerGroup().addTo(map);
  return { map, markersLayer };
}

export function drawAddressCircle(map, lat, lon, radiusMeters){
  const circle = L.circle([lat,lon], { radius: radiusMeters, color:'#1e66f5', fillColor:'#c7d7fe', fillOpacity:0.25, weight:1 });
  circle.addTo(map); map.setView([lat,lon], radiusMeters<=1000?15:(radiusMeters<=2000?14:13));
  return circle;
}

export function markerFor(f, ipsMap){
  const ips = ipsMap ? ipsMap.get(f.uai) : f.ips;
  const color = colorForIPS(ips);
  const icon = L.divIcon({ className:'est', html:`<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color}"></div>` });
  const m = L.marker([f.lat,f.lon],{icon});
  const ipsTxt = ips!=null ? Number(ips).toFixed(1) : "—";
  const typeHuman = (f.type||"?").replace("ecole","École").replace("college","Collège").replace("lycee","Lycée");
  m.bindPopup(
    `<strong>${f.name||"Établissement"}</strong>
     <div>${typeHuman} — ${f.commune||""}</div>
     <div>Secteur : ${f.secteur || "—"}</div>
     <div>UAI : ${f.uai}</div>
     <div>IPS : ${ipsTxt}</div>`
  );
  return m;
}

export function fitToMarkers(map, items){
  const pts = items.map(i => [i.lat,i.lon]).filter(x => Array.isArray(x) && x.length===2);
  const bounds = L.latLngBounds(pts);
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
}
