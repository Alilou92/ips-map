// js/data.js
import { BASE, DS_GEO, DS_IPS, EXPLORE_BASE } from "./config.js";
import { extractEstablishment, stripDiacritics } from "./util.js";

export async function fetchEstablishmentsAround(lat, lon, radiusMeters, sectorFilter, typesWanted){
  const params = new URLSearchParams({
    dataset: DS_GEO,
    rows: "600",
    // ✅ paramètre correct Opendatasoft (avec un point)
    "geofilter.distance": `${lat},${lon},${radiusMeters}`
  });
  params.append("facet","secteur"); params.append("facet","libelles_nature"); params.append("facet","nature_uai_libe");
  const r = await fetch(`${BASE}?${params}`); if(!r.ok) throw new Error("Données indisponibles");
  let feats = (await r.json()).records?.map(rec=>extractEstablishment(rec.fields)).filter(x=>x.lat&&x.lon&&x.uai) || [];
  if (sectorFilter!=="all") feats = feats.filter(x=>x.secteur===sectorFilter);
  return feats.filter(x=>typesWanted.has(x.type));
}

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
