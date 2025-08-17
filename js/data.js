// js/data.js
import { BASE, DS_GEO, DS_IPS } from "./config.js";
import { extractEstablishment, stripDiacritics } from "./util.js";

/* -------------------- Autour d'une adresse (inchangé) -------------------- */
export async function fetchEstablishmentsAround(lat, lon, radiusMeters, sectorFilter, typesWanted){
  const params = new URLSearchParams({ dataset: "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"600", geofilter_distance: `${lat},${lon},${radiusMeters}` });
  params.append("facet","secteur"); params.append("facet","libelles_nature"); params.append("facet","nature_uai_libe");
  const r = await fetch(`${BASE}?${params}`); if(!r.ok) throw new Error("Données indisponibles");
  let feats = (await r.json()).records?.map(rec=>extractEstablishment(rec.fields)).filter(x=>x.lat&&x.lon&&x.uai) || [];
  if (sectorFilter!=="all") feats = feats.filter(x=>x.secteur===sectorFilter);
  return feats.filter(x=>typesWanted.has(x.type));
}

/* -------------------- Utilitaires existants -------------------- */
export async function fetchEstablishmentsInDepartement(depCode){
  depCode = String(depCode).toUpperCase();
  const tryRefine = async(field)=>{
    const p = new URLSearchParams({ dataset:"fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"5000" });
    p.append("facet","secteur"); p.append("facet","libelles_nature"); p.append("facet","nature_uai_libe");
    p.append(`refine.${field}`, depCode);
    const r = await fetch(`${BASE}?${p}`); return r.ok ? r.json() : {records:[]};
  };
  let js = await tryRefine('code_departement');
  if (!js.records?.length) js = await tryRefine('code_du_departement');
  if (!js.records?.length){
    const p = new URLSearchParams({ dataset:"fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"5000", q:`code_departement:${depCode} OR code_du_departement:${depCode}` });
    p.append("facet","secteur"); p.append("facet","libelles_nature"); p.append("facet","nature_uai_libe");
    const r = await fetch(`${BASE}?${p}`); js = r.ok ? await r.json() : {records:[]};
  }
  return (js.records||[]).map(rec=>extractEstablishment(rec.fields)).filter(x=>x.lat&&x.lon&&x.uai&&x.type);
}

export async function buildIPSIndex(uaisByType){
  const result = new Map();
  async function fetchIpsChunk(dataset, uaisChunk){
    // On interroge l’API "search v1.0" pour être tolérant CORS
    const p = new URLSearchParams({ dataset, rows: "1000" });
    p.append("refine.uai", uaisChunk[0] || ""); // v1.0 ne gère pas IN → on boucle
    // On fera une boucle extérieure de 1 UAI par appel (voir plus bas)
    const r = await fetch(`${BASE}?${p}`);
    if(!r.ok) return [];
    const js = await r.json();
    const rows = (js.records||[]).map(rec=>{
      const f = rec.fields||{};
      const uai = f.uai || f.code_uai;
      const ips = Number(f.ips ?? f.indice_position_sociale ?? f.indice);
      return { uai, ips: isNaN(ips) ? null : ips };
    });
    return rows;
  }
  for (const [k,dataset] of Object.entries(DS_IPS)){
    const set = uaisByType[k]; if (!set?.size) continue;
    for (const u of set){
      const rows = await fetchIpsChunk(dataset, [u]);
      for (const row of rows) if (row.uai && !result.has(row.uai)) result.set(row.uai, row.ips);
    }
  }
  return result;
}

export async function getLatestRentree(dataset){
  try{
    const p = new URLSearchParams({ dataset, rows:"0", facet:"rentree_scolaire" });
    const js = await (await fetch(`${BASE}?${p}`)).json();
    const facets = js.facet_groups?.find(g=>g.name==="rentree_scolaire")?.facets || [];
    const years = facets.map(f=>parseInt(f.name,10)).filter(n=>!isNaN(n));
    return years.length ? Math.max(...years) : null;
  } catch { return null; }
}

export async function resolveDepartement(input){
  const s = input.trim();
  const isCode = /^(2A|2B|\d{2,3})$/i.test(s);
  if (isCode){
    const code = s.toUpperCase();
    try{
      const p = new URLSearchParams({ dataset:"fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"1" });
      p.append('refine.code_departement', code);
      let js = await (await fetch(`${BASE}?${p}`)).json();
      if (!js.records?.length){
        const p2 = new URLSearchParams({ dataset:"fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"1" });
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
      const p = new URLSearchParams({ dataset:"fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"0", facet:nameField });
      const js = await (await fetch(`${BASE}?${p}`)).json();
      const facets = js.facet_groups?.find(g=>g.name===nameField)?.facets || [];
      const best = facets.find(f=>stripDiacritics(f.name).toUpperCase()===target)
                || facets.find(f=>stripDiacritics(f.name).toUpperCase().includes(target));
      if (best){
        const p2 = new URLSearchParams({ dataset:"fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows:"1" }); p2.append(`refine.${nameField}`, best.name);
        const js2 = await (await fetch(`${BASE}?${p2}`)).json();
        const f = js2.records?.[0]?.fields || {};
        const codeFound = f.code_departement || f.code_du_departement;
        if (codeFound) return { code:String(codeFound), label:best.name };
      }
    } catch {}
  }
  return null;
}

/* -------------------- NOUVEAU : Top 10 DIRECT (API v1.0) -------------------- */
function padDept3(dep){ const s=String(dep).toUpperCase().trim(); if (/^\d{2}$/.test(s)) return "0"+s; return s; }

export async function fetchTop10DeptDirect(depInput, sectorFilter, typesWanted){
  const code2 = String(depInput).toUpperCase();
  const code3 = padDept3(code2);

  const sectorRefine =
    sectorFilter === "Public" ? "Public" :
    sectorFilter === "Privé"  ? "Privé sous contrat" :
    null;

  // helper: interroge un dataset IPS via API search v1.0, filtre par code du département
  async function askDataset(dataset){
    // On force la dernière rentrée si dispo
    const latest = await getLatestRentree(dataset);

    // Essaie avec code sur 3 chiffres, puis 2 chiffres
    const tryOnce = async (codeDep) => {
      const p = new URLSearchParams({ dataset, rows:"5000" });
      p.append("refine.code_du_departement", codeDep);
      if (latest) p.append("refine.rentree_scolaire", String(latest));
      if (sectorRefine) p.append("refine.secteur", sectorRefine);
      const r = await fetch(`${BASE}?${p}`); if(!r.ok) return [];
      const js = await r.json();
      return (js.records||[]).map(rec=>{
        const f = rec.fields||{};
        const uai = f.uai || f.code_uai;
        const name = f.appellation_officielle || f.nom_etablissement || f.nom_de_l_etablissement || f.denomination_principale || "Établissement";
        const commune = f.nom_de_la_commune || f.commune || "";
        const ips = Number(f.ips ?? f.indice_position_sociale ?? f.indice);
        const secteur = f.secteur || "—";
        const label = f.departement || null;
        return { uai, name, commune, ips: isNaN(ips)?null:ips, secteur, label };
      });
    };

    let rows = await tryOnce(code3);
    if (!rows.length) rows = await tryOnce(code2); // fallback
    return rows;
  }

  const out = { label: null, byType: { ecole: [], college: [], lycee: [] } };
  for (const t of ["ecole","college","lycee"].filter(tt=>typesWanted.has(tt))){
    const dataset = DS_IPS[t];
    let rows = await askDataset(dataset);
    // tri décroissant sur l’IPS + coupe top 10 (on ne garde que cellules avec IPS)
    rows = rows.filter(r=>r.ips!=null).sort((a,b)=>b.ips-a.ips).slice(0,10);
    if (!out.label) out.label = rows[0]?.label || null;
    out.byType[t] = rows.map(r => ({ ...r, code_departement: code3 }));
  }
  if (!out.label) out.label = code2;
  return out;
}

/* pour poser des marqueurs : géoloc depuis l’annuaire géolocalisé */
export async function fetchGeoByUai(uai){
  const p = new URLSearchParams({ dataset: "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre", rows: "1" });
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
