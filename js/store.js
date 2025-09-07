// js/store.js — secteur canonisé ("Public"/"Privé") + filtre robuste
import { strip, distanceMeters } from "./util.js?v=3";

/** Cache-bust pour les JSON statiques */
const DATA_VERSION = "23";

/* ---------- utils ---------- */
const toNum = (x) => (x === null || x === undefined || x === "" ? null : Number(x));
const isFiniteNum = (x) => Number.isFinite(x);

/* normalise un code dép (01, 94, 2A/2B, 971…976) */
function normDeptLocal(d) {
  let s = String(d || "").trim().toUpperCase();
  if (/^\d{3}$/.test(s) && s.startsWith("0")) s = s.slice(1);
  if (s === "2A" || s === "2B") return s;
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0");
  if (/^97[1-6]$/.test(s)) return s;
  return s;
}

/* déduit dép depuis CP (pas de 2A/2B ici) */
function depFromPostcode(cp) {
  const s = String(cp || "").trim();
  if (/^\d{5}$/.test(s)) {
    if (s.startsWith("97") || s.startsWith("98")) return s.slice(0, 3);
    return s.slice(0, 2).padStart(2, "0");
  }
  return "";
}

/* -------- Secteur: normalisation + comparaison -------- */

/** string → ascii sans diacritiques, minuscule, trim */
function asciiLower(x){
  return String(x ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu,"")
    .toLowerCase().trim();
}

/** Essaye d’extraire un token "public" | "prive" | null depuis n’importe quoi */
function sectorToken(x){
  if (x === 1 || x === "1") return "public";
  if (x === 2 || x === "2") return "prive";
  const s = asciiLower(x);
  if (!s) return null;
  if (s.includes("priv")) return "prive";      // "prive", "privé sous contrat", etc.
  if (s.includes("pub"))  return "public";     // "public", "publique", "secteur public"
  return null;
}

/** Canonise vers un libellé affichable: "Public" | "Privé" | "—" */
function canonSector(x){
  const tok = sectorToken(x);
  if (tok === "public") return "Public";
  if (tok === "prive")  return "Privé";
  return "—";
}

/** Compare un établissement contre le filtre utilisateur ("all" passe tout) */
function sectorMatches(estSector, filter){
  if (filter === "all") return true;
  const want = sectorToken(filter);
  if (!want) return true;       // filtre inconnu -> pas de filtre
  const have = sectorToken(estSector);
  return have === want;
}

/** Essaie d’extraire le secteur depuis divers champs bruts (au cas où) */
function extractSectorFromAny(raw) {
  const CANDIDATES = [
    "secteur",
    "secteur_d_etablissement",
    "secteur_public_prive",
    "statut_public_prive",
    "public_prive",
    "secteur_prive_libelle_type_contrat",
    "secteur_prive_libelle",
    "statut",
    "statut_uai",
    "secteur_uai",
    "type_contrat",
    "contrat_etablissement",
    "nature_secteur",
    "secteur_etablissement",
  ];
  for (const k of CANDIDATES) {
    if (raw && raw[k] != null) {
      const lab = canonSector(raw[k]);
      if (lab !== "—") return lab;
    }
  }
  // fallback : aucune info fiable
  return "—";
}

/* -------- gazetteer -------- */
function normalizeGazetteerEntry(x) {
  const name = x?.name ?? x?.n ?? "";
  const dep = normDeptLocal(x?.dep ?? x?.codeDepartement ?? "");
  let lat = toNum(x?.lat);
  let lon = toNum(x?.lon);
  if (!isFiniteNum(lat) || !isFiniteNum(lon)) {
    const coords = x?.centre?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) { lon = toNum(coords[0]); lat = toNum(coords[1]); }
  }
  let cps = [];
  if (Array.isArray(x?.cps)) cps = x.cps;
  else if (Array.isArray(x?.cp)) cps = x.cp;
  else if (Array.isArray(x?.codesPostaux)) cps = x.codesPostaux;

  return (name && isFiniteNum(lat) && isFiniteNum(lon)) ? { name, dep, cps, lat, lon } : null;
}

/* -------- établissements -------- */
function normalizeEstab(e) {
  if (!e) return null;

  const uai = String(e.uai ?? e.code_uai ?? e.numero_uai ?? "").trim().toUpperCase(); // << canon

  // type
  const typeRaw = e.type ?? e.nature ?? e.nature_uai_libe ?? "";
  const tU = String(typeRaw).toUpperCase();
  let typeKey = e.type;
  if (!typeKey) {
    if (tU.includes("ÉCOLE") || tU.includes("ECOLE")) typeKey = "ecole";
    else if (tU.includes("COLLÈGE") || tU.includes("COLLEGE")) typeKey = "college";
    else if (tU.includes("LYCÉE") || tU.includes("LYCEE")) typeKey = "lycee";
  }
  if (!typeKey) return null;

  // secteur : priorité à e.secteur si présent, sinon on tente les autres champs
  const secteur = e.secteur != null ? canonSector(e.secteur) : extractSectorFromAny(e);

  // coordonnées
  let lat = toNum(e.lat), lon = toNum(e.lon);
  if (!isFiniteNum(lat) || !isFiniteNum(lon)) {
    const w = e.wgs84 || e.geo_point_2d || e.geopoint || e.geolocalisation || e.position || e.coordonnees;
    if (w && typeof w === "object" && "lat" in w && "lon" in w) { lat = toNum(w.lat); lon = toNum(w.lon); }
    else if (Array.isArray(w) && w.length >= 2) { lat = toNum(w[0]); lon = toNum(w[1]); }
  }
  if (!uai || !isFiniteNum(lat) || !isFiniteNum(lon)) return null;

  const depRaw = e.dep ?? e.code_departement ?? e.code_du_departement ?? "";
  const cp = String(e.cp ?? e.code_postal ?? e.adresse_code_postal ?? e.code_postal_uai ?? "").trim();
  const dep = normDeptLocal(depRaw || depFromPostcode(cp));

  const name = String(
    e.name ?? e.appellation_officielle ?? e.nom_etablissement ??
    e.nom_de_l_etablissement ?? e.libelle ?? e.raison_sociale ?? "Établissement"
  );
  const commune = String(e.commune ?? e.libelle_commune ?? e.nom_de_la_commune ?? e.nom_commune ?? "");

  return { uai, type: typeKey, secteur, lat, lon, dep, cp, commune, name };
}

/* -------- IPS -------- */
function normalizeIps(ipsRaw) {
  const map = new Map();
  if (Array.isArray(ipsRaw)) {
    for (const row of ipsRaw) {
      const u = String(row?.uai ?? row?.code_uai ?? "").trim().toUpperCase(); // << canon
      const v = toNum(row?.ips ?? row?.indice_position_sociale ?? row?.indice);
      if (u && isFiniteNum(v)) map.set(u, v);
    }
  } else if (ipsRaw && typeof ipsRaw === "object") {
    for (const [k, v] of Object.entries(ipsRaw)) {
      const u = String(k).trim().toUpperCase(); // << canon
      const num = toNum(v);
      if (u && isFiniteNum(num)) map.set(u, num);
    }
  }
  return map;
}

const Store = {
  ready: false,

  establishments: [],
  ipsMap: new Map(),
  byDept: new Map(),
  byCP: new Map(),
  gazetteer: [],

  async load() {
    const [estRes, ipsRes, gazRes] = await Promise.all([
      fetch(`./data/establishments.min.json?v=${DATA_VERSION}`),
      fetch(`./data/ips.min.json?v=${DATA_VERSION}`),
      fetch(`./data/gazetteer.min.json?v=${DATA_VERSION}`)
    ]);
    if (!estRes.ok) throw new Error(`Impossible de charger establishments.min.json (${estRes.status})`);
    if (!ipsRes.ok) throw new Error(`Impossible de charger ips.min.json (${ipsRes.status})`);
    if (!gazRes.ok) throw new Error(`Impossible de charger gazetteer.min.json (${gazRes.status})`);

    const [estRaw, ipsRaw, gazRaw] = await Promise.all([ estRes.json(), ipsRes.json(), gazRes.json() ]);

    // normalisation + secteur canonisé ici
    const est = Array.isArray(estRaw) ? estRaw.map(normalizeEstab).filter(Boolean) : [];
    const ipsMap = normalizeIps(ipsRaw);
    const gaz = Array.isArray(gazRaw) ? gazRaw.map(normalizeGazetteerEntry).filter(Boolean) : [];

    this.establishments = est;
    this.ipsMap = ipsMap;
    this.gazetteer = gaz;

    // index
    this.byDept.clear();
    this.byCP.clear();
    for (const e of est) {
      const dep = normDeptLocal(e.dep || "");
      if (dep) {
        if (!this.byDept.has(dep)) this.byDept.set(dep, []);
        this.byDept.get(dep).push(e);
      }
      if (e.cp) {
        if (!this.byCP.has(e.cp)) this.byCP.set(e.cp, []);
        this.byCP.get(e.cp).push(e);
      }
    }

    this.ready = true;

    // stats console (diagnostic)
    try {
      const total = this.establishments.length;
      const pub = this.establishments.filter(e => sectorToken(e.secteur) === "public").length;
      const pri = this.establishments.filter(e => sectorToken(e.secteur) === "prive").length;
      const none = total - pub - pri;
      console.debug(`[Store] établissements: ${total} • Public: ${pub} • Privé: ${pri} • Sans info: ${none}`);

      const types = ["ecole","college","lycee"];
      for (const t of types) {
        const tot = this.establishments.filter(e => e.type === t).length;
        const withIps = this.establishments.filter(e => e.type === t && Number.isFinite(this.ipsMap.get(e.uai))).length;
        const pct = Math.round(100 * withIps / Math.max(1, tot));
        console.debug(`[IPS] Couverture ${t}: ${withIps}/${tot} (${pct}%)`);
      }
    } catch {}
  },

  /** Trouve une commune par nom (exact/contient) */
  findCommune(query) {
    const q = strip(String(query)).toUpperCase().trim().replace(/\s+/g, " ");
    if (!q) return null;
    return this.gazetteer.find(c => strip(c.name).toUpperCase() === q)
        || this.gazetteer.find(c => strip(c.name).toUpperCase().includes(q))
        || null;
  },

  /** Top 10 IPS par type sur un département */
  top10ByDept(depInput, typesWanted, sectorFilter) {
    const dep = normDeptLocal(depInput);

    const prim = this.byDept.get(dep) || [];
    const viaCP = [];
    const isNumDep = /^\d{2}$/.test(dep) || /^97[1-6]$/.test(dep);
    if (isNumDep) {
      for (const e of this.establishments) {
        if (!e.cp) continue;
        if (String(e.cp).startsWith(dep)) viaCP.push(e);
      }
    }

    const seen = new Set();
    const candidates = [];
    for (const e of prim) { if (!seen.has(e.uai)) { seen.add(e.uai); candidates.push(e); } }
    for (const e of viaCP) { if (!seen.has(e.uai)) { seen.add(e.uai); candidates.push(e); } }

    const out = { ecole: [], college: [], lycee: [] };
    for (const t of ["ecole", "college", "lycee"]) {
      if (!typesWanted.has(t)) continue;
      const list = candidates
        .filter(e => e.type === t && sectorMatches(e.secteur, sectorFilter))
        .map(e => ({ ...e, ips: this.ipsMap.get(e.uai) }))
        .filter(e => Number.isFinite(e.ips))
        .sort((a, b) => b.ips - a.ips)
        .slice(0, 10);
      out[t] = list;
    }
    return out;
  },

  /** Établissements dans un rayon (m) autour d’un point */
  around(lat, lon, radiusMeters, sectorFilter = "all", typesWanted = new Set(["ecole","college","lycee"])) {
    const results = [];
    for (const e of this.establishments) {
      if (!typesWanted.has(e.type)) continue;
      if (!sectorMatches(e.secteur, sectorFilter)) continue;
      const d = distanceMeters(lat, lon, e.lat, e.lon);
      if (d <= radiusMeters) results.push({ ...e, distance: d, ips: this.ipsMap.get(e.uai) });
    }
    results.sort((a,b) => a.distance - b.distance);
    return results;
  },

  /** Via CP exact */
  byPostcode(cp, sectorFilter = "all", typesWanted = new Set(["ecole","college","lycee"])) {
    const list = this.byCP.get(String(cp)) || [];
    return list
      .filter(e => typesWanted.has(e.type) && sectorMatches(e.secteur, sectorFilter))
      .map(e => ({ ...e, ips: this.ipsMap.get(e.uai) }));
  }
};

export default Store;
