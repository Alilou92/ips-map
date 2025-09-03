// js/geocode.js — géocodage robuste (BAN -> GéoAPI -> Nominatim), avec support code postal
// Retourne { lat, lon, label, provider }

async function tryBAN(query) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1&autocomplete=1&type=street&type=locality&type=municipality&type=postcode&type=housenumber`;
    const r = await fetch(url, { headers: { "Accept": "application/json" }});
    if (!r.ok) return null;
    const js = await r.json();
    const f = js.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const [lon, lat] = coords;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const label = f.properties?.label || query;
        return { lat, lon, label, provider: "BAN" };
      }
    }
    return null;
  } catch { return null; }
}

async function tryGeoApiByPostcode(cp) {
  try {
    const url = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(cp)}&fields=centre,nom&format=json`;
    const r = await fetch(url, { headers: { "Accept": "application/json" }});
    if (!r.ok) return null;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length) {
      const c = arr[0];
      const lat = c?.centre?.coordinates?.[1];
      const lon = c?.centre?.coordinates?.[0];
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, label: `${c.nom} (${cp})`, provider: "GEO_CP" };
      }
    }
    return null;
  } catch { return null; }
}

async function tryGeoApiByName(name) {
  try {
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(name)}&fields=centre,nom,code,codesPostaux&boost=population&limit=1`;
    const r = await fetch(url, { headers: { "Accept": "application/json" }});
    if (!r.ok) return null;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length) {
      const c = arr[0];
      const lat = c?.centre?.coordinates?.[1];
      const lon = c?.centre?.coordinates?.[0];
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const label = c.nom + (c.codesPostaux?.length ? ` (${c.codesPostaux[0]})` : "");
        return { lat, lon, label, provider: "GEO_NOM" };
      }
    }
    return null;
  } catch { return null; }
}

async function tryNominatim(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1&accept-language=fr`;
    const r = await fetch(url, { headers: { "Accept": "application/json" }});
    if (!r.ok) return null;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length) {
      const it = arr[0];
      const lat = Number(it.lat);
      const lon = Number(it.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, label: it.display_name || query, provider: "NOMINATIM" };
      }
    }
    return null;
  } catch { return null; }
}

export async function geocode(q){
  const query = (q || "").trim();
  if (!query) throw new Error("Adresse introuvable");

  const isCP = /^\d{5}$/.test(query);

  // Si code postal: commencer par GéoAPI (évite rate-limit BAN)
  if (isCP) {
    const g1 = await tryGeoApiByPostcode(query);
    if (g1) return g1;
    const b = await tryBAN(query);
    if (b) return b;
    const n = await tryNominatim(query);
    if (n) return n;
    throw new Error("Géocodage indisponible");
  }

  // Sinon: BAN -> GéoAPI (nom) -> Nominatim
  const b = await tryBAN(query);
  if (b) return b;

  const g2 = await tryGeoApiByName(query);
  if (g2) return g2;

  const n = await tryNominatim(query);
  if (n) return n;

  throw new Error("Géocodage indisponible");
}
