// js/data.js
import { BASE, DS_GEO, DS_IPS, EXPLORE_BASE } from "./config.js";
import { extractEstablishment, stripDiacritics } from "./util.js";

/* -------------------- Autour d'une adresse (inchangé) -------------------- */
export async function fetchEstablishmentsAround(lat, lon, radiusMeters, sectorFilter, typesWanted){
  const params = new URLSearchParams({ dataset: DS_GEO, rows:"600", geofilter_distance: `${lat},${lon},${radiusMeters}` });
  params.append("facet","secteur"); params.append("facet","libelles_nature"); params.append("facet","nature_uai_libe");
  const r = await fetch(`${BASE}?${params}`); if(!r.ok) throw new Error("Données indisponibles");
  let feats = (await r.json()).records?.map(rec=>extractEstablishment(rec.fields)).filter(x=>x.lat&&x.lon&&x.uai) || [];
  if (sectorFilter!=="all") feats = feats.filter(x=>x.secteur===sectorFilter);
  return feats.filter(x=>typesWanted.has(x.type));
}

/* -------------------- Utilitaires existants (géoloc / établissement) -------------------- */
export async function fetchEstablishmentsInDepartement(depCode){
  depCode = String(depCode).toUpperCase();
  const tryRefine = async(field)=>{
    const p = new URLSearchParams({ dataset:DS_GEO, rows:"5000" });
    p.append("facet","secteur"); p.append("facet","libelles_nature"); p.append("facet","nature_uai_libe");
    p.append(`refine.${field}`, depCode);
    const r = await fetch(`${BASE}?${p}`); return r.ok ? r.json() : {records:[]};
  };
  let js = await tryRefine('code_departement');
  if (!js.records?.length) js = await tryRefine('code_du_departement');
  if (!js.records?.length){
    const p = new URLSearchParams({ dataset:DS_GEO, rows:"5000", q:`code_departement:${depCode} OR code_du_departement:${depCode}` });
    p.append("facet","secteur"); p.append("facet","libelles_nature"); p.append("facet","nature_uai_libe");
    const r = await fetch(`${BASE}?${p}`); js = r.ok ? await r.json() : {records:[]};
  }
  return (js.records||[]).map(rec=>extractEstablishment(rec.fields)).filter(x=>x.lat&&x.lon&&x.uai&&x.type);
}

/* -------------------- Index IPS (autour d'une adresse) -------------------- */
export async function buildIPSIndex(uaisByType){
  const result = new Map();
  async function fetchIpsChunk(dataset, uaisChunk){
    const list = uaisChunk.map(u => `"${u}"`).join(",");
    let url = `${EXPLORE_BASE}${dataset}/records?select=uai,ips,indice_position_sociale,indice&where=uai IN (${list})&limit=1000`;
    let r = await fetch(url); let js = r.ok ? await r.json() : { results: [] }; let rows = js.results || [];
    if (!rows.length) {
      url = `${EXPLORE_BASE}${dataset}/records?select=code_uai,ips,indice_position_sociale,indice&where=code_uai IN (${list})&limit=1000`;
      r = await fetch(url); js = r.ok ? await r.json() : { results: [] };
      rows = (js.results || []).map(x => ({ uai: x.code_uai, ips: x.ips ?? x.indice_position_sociale ?? x.indice }));
    } else {
      rows = rows.map(x => ({ uai: x.uai, ips: x.ips ?? x.indice_position_sociale ?? x.indice }));
    }
    return rows;
  }
  for (const [k,dataset] of Object.entries(DS_IPS)){
    const set = uaisByType[k]; if (!set?.size) continue;
    const uais = Array.from(set); const chunk = 90;
    for (let i=0;i<uais.length;i+=chunk){
      const subset = uais.slice(i,i+chunk);
      const rows = await fetchIpsChunk(dataset, subset);
      for (const row of rows){
        if (row.uai && !result.has(row.uai)) result.set(row.uai, row.ips!=null? Number(row.ips):null);
      }
    }
  }
  return result;
}

/* -------------------- Rentrée (utilisé pour info d'affichage, pas pour filtrer) -------------------- */
export async function getLatestRentree(dataset){
  try{
    const p = new URLSearchParams({ dataset, rows:"0", facet:"rentree_scolaire" });
    const js = await (await fetch(`${BASE}?${p}`)).json();
    const facets = js.facet_groups?.find(g=>g.name==="rentree_scolaire")?.facets || [];
    const years = facets.map(f=>parseInt(f.name,10)).filter(n=>!isNaN(n));
    return years.length ? Math.max(...years) : null;
  } catch { return null; }
}

/* -------------------- Résolution département (texte -> code) -------------------- */
export async function resolveDepartement(input){
  const s = input.trim();
  const isCode = /^(2A|2B|\d{2,3})$/i.test(s);
  if (isCode){
    const code = s.toUpperCase();
    try{
      const p = new URLSearchParams({ dataset:DS_GEO, rows:"1" });
      p.append('refine.code_departement', code);
      let js = await (await fetch(`${BASE}?${p}`)).json();
      if (!js.records?.length){
        const p2 = new URLSearchParams({ dataset:DS_GEO, rows:"1" });
        p2.append('refine.code_du_departement', code);
        js = await (await fetch(`${BASE}?${p2}`)).json();
      }
      const f = js.records?.[0]?.fields || {};
      return { code, label: f.departement || f.nom_departement || code };
    } catch { return { code, label: code }; }
  }
  const target = stripDiacritics(s).toUpperCase().replace(/\b(DEPARTEMENT|DPT|DEPT)\b/g,"").trim();
  for (const nameField of ["departement","nom_departement"]){
    try{
      const p = new URLSearchParams({ dataset:DS_GEO, rows:"0", facet:nameField });
      const js = await (await fetch(`${BASE}?${p}`)).json();
      const facets = js.facet_groups?.find(g=>g.name===nameField)?.facets || [];
      const best = facets.find(f=>stripDiacritics(f.name).toUpperCase()===target)
                || facets.find(f=>stripDiacritics(f.name).toUpperCase().includes(target));
      if (best){
        const p2 = new URLSearchParams({ dataset:DS_GEO, rows:"1" }); p2.append(`refine.${nameField}`, best.name);
        const js2 = await (await fetch(`${BASE}?${p2}`)).json();
        const f = js2.records?.[0]?.fields || {};
        const codeFound = f.code_departement || f.code_du_departement;
        if (codeFound) return { code:String(codeFound), label:best.name };
      }
    } catch {}
  }
  return null;
}

/* -------------------- Top 10 DIRECT par département (robuste) -------------------- */
/* Gère 94/094, code_du_departement/code_departement, filtre secteur côté client,
   détecte la dernière rentrée présente, puis trie/Top 10 sur IPS. */

function padDeptCodes(inp){
  const c = String(inp).toUpperCase().trim();
  const c2 = c;                               // "94", "2A", "971"...
  const c3 = /^\d{2}$/.test(c2) ? "0"+c2 : c2; // "94" -> "094"
  return [c2, c3];
}
const toInt = v => { const n = parseInt(v,10); return Number.isFinite(n) ? n : null; };
const normSect = s => {
  s = (s||"").toLowerCase();
  if (s.startsWith("pub")) return "Public";
  if (s.startsWith("priv")) return "Privé";
  return "—";
};

export async function fetchTop10DeptDirect(depInput, sectorFilter, typesWanted){
  const [code2, code3] = padDeptCodes(depInput);

  async function fetchAll(dataset){
    async function tryRef(field, code){
      const p = new URLSearchParams({ dataset, rows:"5000" });
      p.append(`refine.${field}`, code);
      const r = await fetch(`${BASE}?${p}`); if(!r.ok) return [];
      const js = await r.json();
      return (js.records||[]).map(rec => rec.fields || {});
    }
    // essaie code_du_departement puis code_departement, 094 puis 94
    let rows = await tryRef("code_du_departement", code3);
    if (!rows.length) rows = await tryRef("code_du_departement", code2);
    if (!rows.length) rows = await tryRef("code_departement",  code3);
    if (!rows.length) rows = await tryRef("code_departement",  code2);

    if (!rows.length){
      // filet de sécurité : recherche plein texte
      const p = new URLSearchParams({
        dataset, rows:"5000",
        q: `code_du_departement:${code3} OR code_du_departement:${code2} OR code_departement:${code3} OR code_departement:${code2}`
      });
      const r = await fetch(`${BASE}?${p}`);
      if (r.ok){
        const js = await r.json();
        rows = (js.records||[]).map(rec => rec.fields || {});
      }
    }

    // normalisation des champs utiles
    return rows.map(f => {
      const ips = Number(f.ips ?? f.indice_position_sociale ?? f.indice);
      return {
        uai: f.uai || f.code_uai || f.numero_uai,
        name: f.appellation_officielle || f.nom_etablissement || f.nom_de_l_etablissement || f.denomination_principale || "Établissement",
        commune: f.nom_de_la_commune || f.commune || "",
        secteur: f.secteur || f.secteur_public_prive || "—",
        departement_label: f.departement || f.nom_departement || null,
        rentree: toInt(f.rentree_scolaire ?? f.annee_scolaire ?? f.annee),
        ips: Number.isFinite(ips) ? ips : null
      };
    });
  }

  const out = { label: null, byType: { ecole: [], college: [], lycee: [] } };

  for (const t of ["ecole","college","lycee"].filter(tt => typesWanted.has(tt))){
    const dataset = DS_IPS[t];
    let rows = await fetchAll(dataset);

    // filtre secteur côté client (plus tolérant aux libellés)
    if (sectorFilter !== "all"){
      rows = rows.filter(r => {
        const s = normSect(r.secteur);
        return sectorFilter === "Public" ? s === "Public" : s === "Privé";
      });
    }

    // détecte la dernière rentrée présente (si dispo), puis Top 10 par IPS
    const years = rows.map(r => r.rentree).filter(v => v != null);
    const latest = years.length ? Math.max(...years) : null;

    let filtered = latest != null ? rows.filter(r => r.rentree === latest) : rows;
    filtered = filtered.filter(r => r.ips != null).sort((a,b) => b.ips - a.ips).slice(0, 10);

    if (!out.label) out.label = rows.find(r => r.departement_label)?.departement_label || code3;
    out.byType[t] = filtered;
  }

  if (!out.label) out.label = code3;
  return out;
}

/* -------------------- Géoloc par UAI (pour poser des marqueurs) -------------------- */
export async function fetchGeoByUai(uai){
  const p = new URLSearchParams({ dataset: DS_GEO, rows: "1" });
  p.append("refine.numero_uai", uai);
  const r = await fetch(`${BASE}?${p}`);
  if (!r.ok) return null;
  const js = await r.json();
  const f = js.records?.[0]?.fields;
  if (!f) return null;
  const w = f.wgs84 || f.geo_point_2d || f.geopoint || f.geolocalisation;
  if (Array.isArray(w)) return { lat: Number(w[0]), lon: Number(w[1]) };
  if (w && typeof w === "object") return { lat: Number(w.lat), lon: Number(w.lon) };
  return null;
}
