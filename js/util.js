// js/util.js (v=18)
export const pick = (obj, ...keys) => { for (const k of keys) if (obj && obj[k] != null) return obj[k]; };
export const stripDiacritics = s => (s||"").normalize("NFD").replace(/\p{Diacritic}/gu,"");

export function isDeptCode(s = "") {
  s = String(s).trim().toUpperCase();
  return /^(2A|2B|\d{2,3})$/.test(s);
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeSector(val) {
  const s = (val || "").toLowerCase();
  if (s.startsWith("priv")) return "Privé";
  if (s.startsWith("pub")) return "Public";
  return val || "—";
}

// Détection robuste du type
function detectTypeFromNature(f) {
  const chunks = [];
  if (Array.isArray(f.libelles_nature)) chunks.push(...f.libelles_nature);
  if (f.nature_uai_libe) chunks.push(f.nature_uai_libe);
  if (f.type_etablissement) chunks.push(f.type_etablissement);
  const txt = stripDiacritics(chunks.join(" ").toLowerCase());

  if (/(lycee|lyc|lgt|lp|polyvalent|apprentissage|professionnel)/.test(txt)) return "lycee";
  if (/college/.test(txt)) return "college";
  if (/(ecole|maternelle|elementaire|primaire)/.test(txt)) return "ecole";

  const sd = (f.second_degre === true) || String(f.second_degre || "").toUpperCase() === "OUI";
  const pd = (f.premier_degre === true) || String(f.premier_degre || "").toUpperCase() === "OUI";
  if (pd) return "ecole";
  if (sd) return /college/.test(txt) ? "college" : "lycee";

  return null;
}

function extractLatLon(f) {
  const w = f.wgs84 || f.geo_point_2d || f.geopoint || f.geolocalisation || f.geometry;

  if (w && typeof w === "object" && "lat" in w && ("lon" in w || "lng" in w)) {
    return { lat: Number(w.lat), lon: Number(w.lon ?? w.lng) };
  }
  if (w && typeof w === "object" && Array.isArray(w.coordinates) && w.coordinates.length >= 2) {
    const [lon, lat] = w.coordinates; return { lat: Number(lat), lon: Number(lon) };
  }
  if (typeof f.geo_point_2d === "string") {
    const m = f.geo_point_2d.split(",").map(s => Number(s.trim()));
    if (m.length === 2 && m.every(Number.isFinite)) return { lat: m[0], lon: m[1] };
  }
  if (Array.isArray(w) && w.length >= 2) {
    const a = Number(w[0]), b = Number(w[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat:a, lon:b };
      return { lat:b, lon:a };
    }
  }
  return { lat:null, lon:null };
}

export function extractEstablishment(f = {}) {
  const { lat, lon } = extractLatLon(f);
  const uai =
    f.numero_uai || f.uai || f.code_uai || f.identifiant_de_l_etablissement || null;

  const secteur = normalizeSector(f.secteur || f.secteur_public_prive);
  const type = detectTypeFromNature(f);

  const name =
    f.appellation_officielle || f.nom_etablissement || f.nom_de_l_etablissement ||
    f.denomination_principale || f.denomination || "Établissement";

  const commune =
    f.nom_de_la_commune || f.commune || f.libelle_commune || f.nom_commune || "";

  return { uai, name, commune, lat, lon, secteur, type, raw: f };
}
