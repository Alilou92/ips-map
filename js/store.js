// js/store.js
import { strip } from "./util.js";

const Store = {
  ready: false,
  establishments: [],        // {uai,type,secteur,lat,lon,dep,cp?,commune,name}
  ipsMap: new Map(),         // uai -> ips
  byDept: new Map(),         // dep -> [establishments]
  byCP: new Map(),           // cp -> [establishments] (si présent dans les données)
  gazetteer: [],             // {name, dep?, cps[], lat, lon}

  async load(){
    // ⬇️ Ajoute le cache-busting v=7 sur les 3 JSON
    const [est, ips, gaz] = await Promise.all([
      fetch("./data/establishments.min.json?v=7").then(r=>r.json()),
      fetch("./data/ips.min.json?v=7").then(r=>r.json()),
      fetch("./data/gazetteer.min.json?v=7").then(r=>r.json()),
    ]);

    this.establishments = est;
    this.ipsMap = new Map(Object.entries(ips).map(([k,v])=>[k, Number(v)]));
    this.gazetteer = gaz;

    // Index par département / code postal (si dispo)
    for (const e of est){
      const dep = String(e.dep || "").toUpperCase();
      if (dep){
        if (!this.byDept.has(dep)) this.byDept.set(dep, []);
        this.byDept.get(dep).push(e);
      }
      if (e.cp){
        if (!this.byCP.has(e.cp)) this.byCP.set(e.cp, []);
        this.byCP.get(e.cp).push(e);
      }
    }
    this.ready = true;
  },

  findCommune(query){
    const q = strip(String(query)).toUpperCase().trim().replace(/\s+/g, " ");
    return this.gazetteer.find(c => strip(c.name).toUpperCase()===q)
        || this.gazetteer.find(c => strip(c.name).toUpperCase().includes(q));
  },

  top10ByDept(dep, typesWanted, sector){
    const all = this.byDept.get(String(dep).toUpperCase()) || [];
    const out = { ecole:[], college:[], lycee:[] };
    for (const t of ["ecole","college","lycee"]){
      if (!typesWanted.has(t)) continue;
      const list = all
        .filter(e => e.type===t && (sector==="all" || e.secteur===sector))
        .map(e => ({ ...e, ips: this.ipsMap.get(e.uai) }))
        .filter(e => e.ips!=null)
        .sort((a,b)=>b.ips-a.ips)
        .slice(0,10);
      out[t] = list;
    }
    return out;
  }
};

export default Store;
