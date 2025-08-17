// js/geocode.js (v=11) — BAN
export async function geocode(q){
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1&autocomplete=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Géocodage indisponible");
  const js = await r.json();
  if (!js.features?.length) throw new Error("Adresse introuvable");
  const f = js.features[0];
  const [lon, lat] = f.geometry?.coordinates || [];
  if (typeof lat !== "number" || typeof lon !== "number") throw new Error("Coordonnées indisponibles");
  const label = f.properties?.label || q;
  return { lat, lon, label };
}
