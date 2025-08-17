export async function geocode(q){
  try {
    const u = new URL("https://api-adresse.data.gouv.fr/search/");
    u.searchParams.set("q", q); u.searchParams.set("limit","1");
    const r = await fetch(u);
    if (r.ok){
      const js = await r.json();
      if (js.features && js.features.length){
        const [lon,lat] = js.features[0].geometry.coordinates;
        const label = js.features[0].properties.label;
        return { lat, lon, label };
      }
    }
  } catch {}
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format","json"); url.searchParams.set("q",q); url.searchParams.set("limit","1");
  const res = await fetch(url, {headers:{'Accept-Language':'fr'}});
  if(!res.ok) throw new Error("Échec du géocodage");
  const js = await res.json(); if(!js.length) throw new Error("Adresse introuvable");
  return {lat:parseFloat(js[0].lat), lon:parseFloat(js[0].lon), label:js[0].display_name};
}
