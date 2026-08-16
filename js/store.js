// js/store.js — secteur canonisé ("Public"/"Privé") + filtre robuste
import { strip, distanceMeters } from "./util.js?v=3";

/** Cache-bust pour les JSON statiques */
const DATA_VERSION = "27";

/* ---------- utils ---------- */
const toNum = (x) => (x === null || x === undefined || x === "" ? null : Number(x));
const isFiniteNum = (x) => Number.isFinite(x);

/* normalise un code dép (01, 94, 2A/2B, 971…976) */
function normDeptLocal(d) {
  let s = String(d || "").trim().toUpperCase();
  // la Corse arrive en "02A"/"02B" dans l'annuaire, l'app raisonne en "2A"/"2B"
  if (/^0?2[AB]$/.test(s)) return s.slice(-2);
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
  ready: false,          // index des départements chargé
  version: "",           // cache-buster daté, écrit par le build

  index: null,           // { deps: { "94": {bbox:[latMin,lonMin,latMax,lonMax], n} }, examsMeta }
  loadedDeps: new Set(),

  establishments: [],    // union des départements déjà chargés
  ipsMap: new Map(),
  examsMap: new Map(),
  examsMeta: {},
  byDept: new Map(),
  byCP: new Map(),
  gazetteer: [],

  _loading: null,
  _depPromises: new Map(),
  _gazPromise: null,

  /** Amorçage : version + index des départements. Quelques kilo-octets. */
  load() {
    if (this.ready) return Promise.resolve();
    if (!this._loading) {
      this._loading = this._load().catch(err => { this._loading = null; throw err; });
    }
    return this._loading;
  },

  async _load() {
    // version.json n'est jamais mis en cache : c'est lui qui date tout le reste,
    // ce qui évite d'incrémenter un numéro à la main à chaque rebuild.
    try {
      const r = await fetch("./data/version.json", { cache: "no-store" });
      if (r.ok) this.version = (await r.json()).v || "";
    } catch { /* pas bloquant : on repart sur des URL sans suffixe */ }

    const res = await fetch(this._url("./data/dep/index.json"));
    if (!res.ok) throw new Error(`Index des départements indisponible (${res.status})`);
    this.index = await res.json();
    this.examsMeta = this.index.examsMeta || {};
    this.ready = true;
    console.debug(`[Store] index prêt — ${Object.keys(this.index.deps || {}).length} départements, données du ${this.version}`);
  },

  _url(path) {
    return this.version ? `${path}?v=${encodeURIComponent(this.version)}` : path;
  },

  /** Départements présents dans les cellules que le cercle recoupe.
      Grille de 0,1° construite au build : règle les rayons à cheval sur une
      frontière sans table d'adjacence, et sans se laisser piéger par les
      coordonnées aberrantes de l'annuaire. */
  depsForCircle(lat, lon, radiusMeters) {
    const grid = this.index?.grid;
    if (!grid) return [];
    const dLat = radiusMeters / 111000;
    const dLon = radiusMeters / (111000 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    const out = new Set();
    const y0 = Math.floor((lat - dLat) * 10), y1 = Math.floor((lat + dLat) * 10);
    const x0 = Math.floor((lon - dLon) * 10), x1 = Math.floor((lon + dLon) * 10);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (const d of grid[`${y}_${x}`] || []) out.add(d);
      }
    }
    return [...out];
  },

  /** Charge un ou plusieurs départements et les fusionne dans les index. */
  async loadDeps(deps) {
    await this.load();
    const list = (Array.isArray(deps) ? deps : [deps])
      .map(normDeptLocal)
      .filter(d => d && !this.loadedDeps.has(d));
    if (!list.length) return;
    await Promise.all(list.map(d => this._loadDep(d)));
  },

  _loadDep(dep) {
    if (this._depPromises.has(dep)) return this._depPromises.get(dep);
    const p = (async () => {
      const res = await fetch(this._url(`./data/dep/${dep}.min.json`));
      if (!res.ok) { console.warn(`[Store] département ${dep} indisponible (${res.status})`); return; }
      const b = await res.json();

      const est = Array.isArray(b.etab) ? b.etab.map(normalizeEstab).filter(Boolean) : [];
      for (const e of est) {
        this.establishments.push(e);
        const d = normDeptLocal(e.dep || "");
        if (d) { if (!this.byDept.has(d)) this.byDept.set(d, []); this.byDept.get(d).push(e); }
        if (e.cp) { if (!this.byCP.has(e.cp)) this.byCP.set(e.cp, []); this.byCP.get(e.cp).push(e); }
      }
      for (const [u, v] of Object.entries(b.ips || {})) {
        const n = toNum(v);
        if (isFiniteNum(n)) this.ipsMap.set(String(u).toUpperCase(), n);
      }
      for (const [u, v] of Object.entries(b.exams || {})) {
        if (v && Object.keys(v).length) this.examsMap.set(String(u).toUpperCase(), v);
      }
      this.loadedDeps.add(dep);
      console.debug(`[Store] département ${dep} : ${est.length} établissements`);
    })();
    this._depPromises.set(dep, p);
    return p;
  },

  /** Le répertoire des communes ne sert que de secours au géocodage : chargé
      à la demande, il ne pèse plus sur le premier affichage. */
  loadGazetteer() {
    if (this.gazetteer.length) return Promise.resolve();
    if (!this._gazPromise) {
      this._gazPromise = (async () => {
        try {
          const res = await fetch(this._url("./data/gazetteer.min.json"));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = await res.json();
          this.gazetteer = Array.isArray(raw) ? raw.map(normalizeGazetteerEntry).filter(Boolean) : [];
          console.debug(`[Store] gazetteer : ${this.gazetteer.length} communes`);
        } catch (e) {
          console.warn("[Store] gazetteer indisponible :", e.message);
          this._gazPromise = null;
        }
      })();
    }
    return this._gazPromise;
  },

  /** Résultats d'un établissement, ou null */
  examsFor(uai) {
    return this.examsMap.get(String(uai || "").trim().toUpperCase()) || null;
  },

  /** Trouve une commune par nom (exact -> commence par -> contient) */
  findCommune(query) {
    const norm = (s) => strip(s).replace(/[’']/g, " ").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    const q = norm(query);
    if (!q) return null;

    let exact = null, starts = null, contains = null;
    for (const c of this.gazetteer) {
      const n = norm(c.name);
      if (n === q) { exact = c; break; }
      if (!starts && n.startsWith(q)) starts = c;
      else if (!contains && n.includes(q)) contains = c;
    }
    return exact || starts || contains || null;
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
