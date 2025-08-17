export const pick = (obj, ...keys) => { for (const k of keys) if (obj && obj[k] != null) return obj[k]; };
export const stripDiacritics = s => (s||"").normalize("NFD").replace(/\p{Diacritic}/gu,"");

export function getCoords(f){
  const w = f.wgs84 || f.geo_point_2d || f.geopoint || f.geolocalisation;
  if (Array.isArray(w)) return { lat:Number(w[0]), lon:Number(w[1]) };
  if (w && typeof w==='object') return { lat:Number(w.lat), lon:Number(w.lon) };
  return { lat:undefined, lon:undefined };
}

function finerTypeFromStrings(...labels){
  const s = stripDiacritics(labels.filter(Boolean).join(" ").toLowerCase());
  if (s.includes("college")) return "college";
  if (s.includes("lycee"))   return "lycee";
  if (s.includes("ecole"))   return "ecole";
  return null;
}
function typeFromRecord(f){
  const t = finerTypeFromStrings(pick(f,"libelles_nature","nature_uai_libe","nature_uai_libelle","type_etablissement","type_de_l_etablissement"));
  if (t) return t;
  const code = Number(pick(f,"nature_uai"));
  if (!isNaN(code)) { if (code>=100 && code<200) return "ecole"; if (code>=300 && code<400) return "college"; }
  return null;
}
export function extractEstablishment(f){
  const {lat,lon} = getCoords(f);
  return {
    uai: String(pick(f,"identifiant_de_l_etablissement","numero_uai","uai")||""),
    name: pick(f,"appellation_officielle","denomination_principale","nom_etablissement","nom_de_l_etablissement","libelle_etablissement")||"Établissement",
    type: typeFromRecord(f),
    secteur: pick(f,"secteur","secteur_public_prive","secteur_prive_libelle_type_contrat","secteur_public_prive_libe")||"N/A",
    lat, lon,
    adresse: pick(f,"adresse_1","adresse","adresse_complete"),
    code_postal: pick(f,"code_postal","code_postal_uai"),
    commune: pick(f,"nom_commune","commune","libelle_commune"),
    nature: pick(f,"libelles_nature","nature_uai_libe","nature_uai_libelle")
  };
}
export function distanceMeters(lat1, lon1, lat2, lon2){
  const R = 6371000, toRad = d => d * Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
export const isDeptCode = raw => {
  const s = (raw||"").trim().toUpperCase();
  if (/^(2A|2B)$/.test(s)) return s;
  if (/^\d{2,3}$/.test(s)) return s;
  return null;
};
