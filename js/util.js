// js/util.js
export const pick = (obj, ...keys) => { for (const k of keys) if (obj && obj[k] != null) return obj[k]; };
export const stripDiacritics = s => (s||"").normalize("NFD").replace(/\p{Diacritic}/gu,"");

export function getCoords(f){
  // supporte plusieurs formes possibles dans le dataset
  const w = f.wgs84 || f.geo_point_2d || f.geopoint || f.geolocalisation || f.geometry;

  // objet {lat,lon} ou {lat,lng}
  if (w && typeof w==='object' && ('lat' in w) && ('lon' in w || 'lng' in w)) {
    return { lat:Number(w.lat), lon:Number(w.lon ?? w.lng) };
  }

  // GeoJSON { coordinates: [lon, lat] }
  if (w && typeof w==='object' && Array.isArray(w.coordinates) && w.coordinates.length>=2){
    const [lon, lat] = w.coordinates;
    return { lat:Number(lat), lon:Number(lon) };
  }

  // chaîne "lat,lon"
  if (typeof w === 'string'){
    const parts = w.split(',').map(s => Number(s.trim()));
    if (parts.length>=2 && parts.every(Number.isFinite)) return { lat:parts[0], lon:parts[1] };
  }

  // tableau [lat,lon] ou [lon,lat] → on devine
  if (Array.isArray(w) && w.length>=2){
    const a = Number(w[0]), b = Number(w[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (Math.abs(a)<=90 && Math.abs(b)<=180) return { lat:a, lon:b };
      return { lat:b, lon:a };
    }
  }

  return { lat:undefined, lon:undefined };
}

function finerTypeFromStrings(...labels){
  const s = stripDiacritics(labels.filter(Boolean).join(" ").toLowerCase());
  if (s.includes("lycee") || s.includes("lyc\u00E9e") || /(^|[^a-z])lp($|[^a-z])/i.test(s) || s.includes("polyvalent")) return "lycee";
  if (s.includes("college") || s.includes("coll\u00E8ge")) return "college";
  if (s.includes("ecole") || s.includes("\u00E9cole") || s.includes("maternelle") || s.includes("elementaire") || s.includes("\u00E9l\u00E9mentaire") || s.includes("primaire")) return "ecole";
  return null;
}
function typeFromRecord(f){
  const t = finerTypeFromStrings(
    pick(f,"libelles_nature","nature_uai_libe","nature_uai_libelle","type_etablissement","type_de_l_etablissement")
  );
  if (t) return t;

  const code = Number(pick(f,"nature_uai"));
  if (!isNaN(code)) { if (code>=100 && code<200) return "ecole"; if (code>=300 && code<400) return "college"; }

  // heuristique par degré
  const sd = (f.second_degre === true) || String(f.second_degre||"").toUpperCase()==="OUI";
  const pd = (f.premier_degre === true) || String(f.premier_degre||"").toUpperCase()==="OUI";
  if (pd) return "ecole";
  if (sd) return "lycee";

  return null;
}
export function extractEstablishment(f){
  const {lat,lon} = getCoords(f);
  return {
    uai: String(pick(f,"identifiant_de_l_etablissement","numero_uai","uai","code_uai")||""),
    name: pick(f,"appellation_officielle","denomination_principale","nom_etablissement","nom_de_l_etablissement","libelle_etablissement")||"Établissement",
    type: typeFromRecord(f),
    secteur: pick(f,"secteur","secteur_public_prive","secteur_prive_libelle_type_contrat","secteur_public_prive_libe")||"N/A",
    lat, lon,
    adresse: pick(f,"adresse_1","adresse","adresse_complete"),
    code_postal: pick(f,"code_postal","code_postal_uai"),
    commune: pick(f,"nom_commune","commune","libelle_commune","nom_de_la_commune"),
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
