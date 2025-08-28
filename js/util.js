export function strip(s){return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
export function isDeptCode(s){return /^(2A|2B|\d{2}|\d{3})$/.test(String(s).trim().toUpperCase());}
export function isPostcode(s){return /^\d{5}$/.test(String(s).trim());}
export function km2m(km){return Math.max(0, Number(km||0))*1000;}
export function distanceMeters(lat1,lon1,lat2,lon2){
  const toRad=d=>d*Math.PI/180, R=6371000;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
export function colorForIPS(ips){
  if(ips==null) return "#9aa0a6"; // gris
  if(ips<90) return "#ef4444";
  if(ips<=110) return "#f59e0b";
  return "#22c55e";
}
