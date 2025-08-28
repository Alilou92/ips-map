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
  m.bindPopup(`<strong>${f.name||"Établissement"}</strong><div>${f.type||"?"} — ${f.commune||""}</div><div>UAI : ${f.uai}</div><div>IPS : ${ipsTxt}</div>`);
  return m;
}

export function fitToMarkers(map, items){
  const bounds = L.latLngBounds(items.map(i => [i.lat,i.lon]));
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
}
