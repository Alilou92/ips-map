// js/app.js (v=9 - data locales + gardes)
import Store from "./store.js";
import { initMap, drawAddressCircle, markerFor, fitToMarkers } from "./map.js";
import { strip, distanceMeters, isDeptCode } from "./util.js";
import { renderList, setCount, showErr } from "./ui.js";

// ---- init ----
const { map, markersLayer } = initMap();
let addrCircle = null;
let addrLat = null, addrLon = null;

// Helpers
function clearErr() {
  const el = document.getElementById("err");
  if (el) el.textContent = "";
}
const isPostcode = (s) => /^\d{5}$/.test(String(s).trim());

// ---------------- Geocode (local d’abord, puis BAN en secours) ----------------
async function tryBAN(query) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1&autocomplete=1&type=street&type=locality&type=municipality&type=postcode&type=housenumber`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
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
  } catch {}
  return null;
}

/**
 * géocode “souple” :
 * - CP (5 chiffres) → cherche dans gazetteer (cps)
 * - Nom de commune → gazetteer
 * - Adresse → BAN (secours réseau)
 */
async function geocodeLoose(q) {
  const query = (q || "").trim();
  if (!query) throw new Error("Adresse introuvable");

  if (isPostcode(query)) {
    const cp = query;
    const hits = Store.gazetteer.filter(
      (x) => Array.isArray(x.cps) && x.cps.includes(cp)
    );
    if (hits.length) {
      // centre de la première commune (simple et fiable)
      const c = hits[0];
      return { lat: c.lat, lon: c.lon, label: `${c.name} (${cp})`, provider: "GAZ_CP" };
    }
    // secours BAN si CP inconnu localement
    const b = await tryBAN(cp);
    if (b) return b;
    throw new Error("Code postal inconnu");
  }

  // Commune (nom)
  const byName = Store.findCommune(query);
  if (byName) {
    return { lat: byName.lat, lon: byName.lon, label: byName.name, provider: "GAZ_NAME" };
  }

  // Adresse précise → BAN
  const b = await tryBAN(query);
  if (b) return b;

  throw new Error("Géocodage indisponible");
}

// ---------------- Top 10 par département (local) ----------------
async function runDeptRanking(q, sectorFilter, typesWanted) {
  const depCode = String(q).toUpperCase().trim();
  const byType = Store.top10ByDept(depCode, typesWanted, sectorFilter);

  const count = document.getElementById("count");
  const list = document.getElementById("list");
  list.innerHTML = "";
  count.textContent = `Top 10 — Département ${depCode} (${sectorFilter === "all" ? "Tous secteurs" : sectorFilter})`;

  markersLayer.clearLayers();
  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }

  const order = ["ecole", "college", "lycee"].filter((t) => typesWanted.has(t));
  for (const t of order) {
    const human = t === "ecole" ? "Écoles" : t === "college" ? "Collèges" : "Lycées";
    const arr = byType[t] || [];

    const sec = document.createElement("div");
    sec.innerHTML = `<div class="sectionTitle">${human} — Top 10 <span class="pill small">${depCode}</span></div>`;

    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];

      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="name">#${i + 1} ${it.name}<span class="badge">${it.secteur || "—"}</span></div>
        <div class="meta">${human.slice(0, -1)} — ${it.commune || ""}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <div class="ips">IPS : ${Number(it.ips).toFixed(1)}</div>
          <div class="dist">UAI : ${it.uai}</div>
        </div>`;

      if (it.lat && it.lon) {
        const m = markerFor({ ...it, type: t }, new Map([[it.uai, it.ips]]));
        m.addTo(markersLayer);
        row.addEventListener("click", () => map.setView([it.lat, it.lon], 16));
      }
      sec.appendChild(row);
    }
    list.appendChild(sec);
  }

  const allWithCoords = order.flatMap((t) => byType[t] || []).filter((x) => x.lat && x.lon);
  if (allWithCoords.length) fitToMarkers(map, allWithCoords);
  else showErr("Top 10 listé (peu de coordonnées disponibles pour la carte).");
}

// ---------------- Recherche autour d’une adresse (local) ----------------
async function runAround(q, radiusKm, sectorFilter, typesWanted) {
  const { lat, lon, label } = await geocodeLoose(q);
  addrLat = lat; addrLon = lon;

  if (addrCircle) { map.removeLayer(addrCircle); addrCircle = null; }
  addrCircle = drawAddressCircle(map, lat, lon, radiusKm * 1000);

  markersLayer.clearLayers();

  // filtre dans le cache local
  const feats = Store.establishments
    .filter((e) => typesWanted.has(e.type))
    .filter((e) => sectorFilter === "all" || e.secteur === sectorFilter)
    .map((e) => {
      const d = distanceMeters(lat, lon, e.lat, e.lon);
      return { ...e, distance: d };
    })
    .filter((e) => e.distance <= radiusKm * 1000)
    .sort((a, b) => (a.distance ?? 1e12) - (b.distance ?? 1e12));

  // marqueurs
  const markersByUai = new Map();
  feats.forEach((f) => {
    const m = markerFor(f, Store.ipsMap);
    m.addTo(markersLayer);
    markersByUai.set(f.uai, m);
  });

  // source A
  const src = L.marker([lat, lon], {
    icon: L.divIcon({ className: "src", html: '<div class="src-pin">A</div>' }),
  }).bindPopup(`<strong>Adresse recherchée</strong><div>${label}</div>`).addTo(markersLayer);

  if (!feats.length) {
    setCount("0 établissement trouvé dans le rayon");
    showErr("Aucun établissement trouvé autour de cette zone. Essaie d’élargir le rayon à 2–3 km.");
    map.setView([lat, lon], radiusKm >= 2 ? 13 : 15);
    src.openPopup();
    return;
  }

  setCount(`${feats.length} établissement${feats.length > 1 ? "s" : ""} dans ${radiusKm} km`);
  renderList({ items: feats, ipsMap: Store.ipsMap, markersByUai, map });
  fitToMarkers(map, feats.concat([{ lat, lon }]));
  src.openPopup();
}

// ---------------- Contrôleur ----------------
async function runSearch() {
  const q = document.getElementById("addr").value.trim();
  const radiusKm = parseFloat(document.getElementById("radiusKm").value);
  const sectorFilter = document.getElementById("secteur").value;
  const typesSel = Array.from(document.getElementById("types").selectedOptions).map((o) => o.value);
  const typesWanted = new Set(typesSel.length ? typesSel : ["ecole", "college", "lycee"]);
  if (!q) { showErr("Saisis une adresse, une ville, un code postal ou un département"); return; }

  clearErr();
  const btn = document.getElementById("go");
  btn.disabled = true;
  setCount("Chargement…");

  try {
    // Département → top 10
    const looksLikeDept = isDeptCode(q);
    if (looksLikeDept) {
      await runDeptRanking(q, sectorFilter, typesWanted);
    } else {
      // Ville / CP / Adresse → autour
      await runAround(q, radiusKm, sectorFilter, typesWanted);
    }
  } catch (e) {
    console.error(e);
    showErr("Erreur : " + (e?.message || e));
  } finally {
    btn.disabled = false;
  }
}

// ---------------- Boot ----------------
(async () => {
  try {
    await Store.load();
    // Bind UI
    document.getElementById("go").addEventListener("click", runSearch);
    document.getElementById("addr").addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
    console.log("IPS Map — v9 (local)");
  } catch (e) {
    console.error(e);
    showErr("Impossible de charger les données locales.");
  }
})();
