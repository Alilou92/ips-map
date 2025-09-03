#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Build local data files for IPS Map
# Sorties:
#   data/establishments.min.json  -> [{uai,type,secteur,lat,lon,dep,cp,commune,name}]
#   data/ips.min.json             -> { "<UAI>": <IPS> }
#   data/gazetteer.min.json       -> [{name,cps[],lat,lon,dep?}]
#   data/stations.min.json        -> [{name,type,mode,line?,lat,lon}]

import json, time, unicodedata, urllib.request, gzip, os, re
import re
BASE_EXPLORE = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/"
DS_GEO = "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre"
DS_IPS = {
    "ecole":   "fr-en-ips-ecoles-ap2022",
    "college": "fr-en-ips-colleges-ap2023",
    "lycee":   "fr-en-ips-lycees-ap2023",
}
GEO_COMMUNES = "https://geo.api.gouv.fr/communes?fields=centre,nom,code,codesPostaux&format=json&geometry=centre"

# ---------- IDFM gares/stations ----------
IDFM_DATASET = "emplacement-des-gares-idf"
IDFM_RECORDS = (
    f"https://data.iledefrance-mobilites.fr/api/explore/v2.1/"
    f"catalog/datasets/{IDFM_DATASET}/records?limit=50000"
)
IDFM_DOWNLOAD = (
    f"https://data.iledefrance-mobilites.fr/explore/dataset/{IDFM_DATASET}/"
    f"download/?format=geojson&timezone=UTC&lang=fr&epsg=4326"
)
IDFM_EXPORT = (
    f"https://data.iledefrance-mobilites.fr/explore/dataset/{IDFM_DATASET}/"
    f"exports/geojson?epsg=4326"
)

LOCAL_STATIONS_SOURCE = "data/stations_source.geojson"  # optionnel: si présent, on l'utilise

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36 ips-map-builder/1.7 (+https://github.com/Alilou92/ips-map)")

# ---------------- HTTP utils ----------------
def _fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json, application/geo+json;q=0.9, */*;q=0.1",
            "Accept-Encoding": "gzip",
            "Referer": "https://data.iledefrance-mobilites.fr/",
        },
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        return raw

def get_json(url: str):
    raw = _fetch_bytes(url)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return json.loads(raw)

def load_local_json(path: str):
    with open(path, "rb") as f:
        raw = f.read()
    return json.loads(raw.decode("utf-8"))

# ---------------- text helpers ----------------
def ascii_lower(s):
    if s is None: return ""
    if not isinstance(s, str): s = str(s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.lower().strip()

def pick_ci(d, *names):
    if not isinstance(d, dict): return None
    low = {k.lower(): v for k, v in d.items()}
    for n in names:
        v = low.get(n.lower())
        if v not in (None, ""): return v
    return None

# ---------------- MENJ: établissements/IPS/communes ----------------
def export_json(dataset_id):   return get_json(f"{BASE_EXPLORE}{dataset_id}/exports/json")
def export_geojson(dataset_id):return get_json(f"{BASE_EXPLORE}{dataset_id}/exports/geojson?epsg=4326")

def derive_dep(cp, insee):
    if isinstance(cp, str) and cp.isdigit():
        return cp[:3] if cp.startswith(("97","98")) else cp[:2]
    if isinstance(insee, str):
        if insee.startswith(("2A","2B")): return insee[:2]
        if insee.startswith(("97","98")): return insee[:3]
        return insee[:2]
    return ""

def nature_to_type(nat):
    s = ascii_lower(nat)
    if "ecole" in s or "école" in s:     return "ecole"
    if "college" in s or "collège" in s: return "college"
    if "lycee" in s or "lycée" in s:     return "lycee"
    return None

def canon_sector(val):
    if val in (1, "1"): return "Public"
    if val in (2, "2"): return "Privé"
    s = ascii_lower(val)
    if not s: return "—"
    if "pub"  in s: return "Public"
    if "priv" in s: return "Privé"
    return "—"

SECTOR_KEYS = [
    "secteur","statut_public_prive","secteur_public_prive","public_prive",
    "statut","statut_uai","secteur_uai","secteur_d_etablissement","secteur_etablissement",
    "type_contrat","contrat_etablissement","nature_secteur",
]

def sector_from_props(props):
    for k in SECTOR_KEYS:
        v = pick_ci(props, k)
        if v not in (None, ""):
            c = canon_sector(v)
            if c != "—": return c
    for v in (props or {}).values():
        if isinstance(v, str):
            c = canon_sector(v)
            if c != "—": return c
    return "—"

def build_establishments():
    print("Télécharge l’annuaire géolocalisé (exports GEOJSON)…")
    gj = export_geojson(DS_GEO)
    feats = gj.get("features", []) if isinstance(gj, dict) else []
    print(f"  -> {len(feats)} features")

    out, seen = [], set()
    for ft in feats:
        geom = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not (isinstance(coords, (list, tuple)) and len(coords) >= 2): continue
        lon, lat = coords[0], coords[1]
        try: lat = float(lat); lon = float(lon)
        except Exception: continue

        uai = pick_ci(props, "numero_uai","uai","code_uai")
        if not uai: continue

        nat = pick_ci(props, "nature_uai_libe","libelles_nature","nature","nature_uai","libelle_nature")
        typ = nature_to_type(nat)
        if not typ: continue

        secteur = sector_from_props(props)
        name = pick_ci(props, "appellation_officielle","nom_etablissement","nom_de_l_etablissement",
                       "denomination_principale","denomination_usuelle") or "Établissement"
        commune = pick_ci(props, "nom_de_la_commune","libelle_commune","commune","nom_commune","ville") or ""
        cp = pick_ci(props, "code_postal_uai","adresse_code_postal","code_postal","cp") or ""
        insee = pick_ci(props, "code_commune","code_commune_uai","code_insee_commune","code_commune_insee") or ""
        dep = pick_ci(props, "code_du_departement","code_departement","departement_code","code_dept") or derive_dep(cp,insee)

        row = {"uai":str(uai),"type":typ,"secteur":secteur,"lat":lat,"lon":lon,
               "dep":str(dep or "").upper(),"cp":str(cp or ""), "commune":commune,"name":name}
        key = (row["uai"], row["type"])
        if key in seen: continue
        seen.add(key); out.append(row)

    out.sort(key=lambda x: (x["dep"], x["type"], x["uai"]))
    with open("data/establishments.min.json","w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    print(f"OK: data/establishments.min.json ({len(out)} établissements)")

def build_ips():
    print("Télécharge IPS (exports JSON, dernière rentrée par UAI)…")
    result = {}
    for tag, ds in DS_IPS.items():
        print(f"  • {tag}")
        rows = export_json(ds)
        best = {}
        for r in rows:
            u_raw = pick_ci(r, "uai", "code_uai")
            if not u_raw:
                continue
            u = str(u_raw).strip().upper()

            val = pick_ci(r, "ips", "indice_position_sociale", "indice")
            if val is None:
                for k, v in r.items():
                    if isinstance(k, str) and "ips" in k.lower() and v not in (None, ""):
                        val = v
                        break
            try:
                v = float(val)
            except Exception:
                continue

            y = pick_ci(r, "rentree_scolaire", "rentree", "annee")
            year = int(y) if (isinstance(y, int) or (isinstance(y, str) and y.isdigit())) else None
            prev = best.get(u)
            if not prev or (year is not None and (prev[0] is None or year > prev[0])):
                best[u] = (year, v)

        for u, (_y, v) in best.items():
            result[u] = v
        time.sleep(0.05)

    with open("data/ips.min.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK: data/ips.min.json ({len(result)} UAI avec IPS)")

def build_gazetteer():
    print("Télécharge gazetteer communes…")
    arr = get_json(GEO_COMMUNES)
    out = []
    for c in arr:
        name = c.get("nom")
        centre = c.get("centre", {})
        cps = c.get("codesPostaux") or []
        coords = centre.get("coordinates") or [None,None]
        lon, lat = coords[0], coords[1]
        if name and isinstance(lon,(int,float)) and isinstance(lat,(int,float)):
            dep = ""
            if cps:
                cp0 = str(cps[0]); dep = cp0[:3] if cp0.startswith(("97","98")) else cp0[:2]
            out.append({"name":name,"cps":cps,"lat":lat,"lon":lon,"dep":dep})
    out.sort(key=lambda x: x["name"])
    with open("data/gazetteer.min.json","w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    print(f"OK: data/gazetteer.min.json ({len(out)} communes)")

# ---------- IDFM: stations ----------
def _ascii_lower(x: str) -> str:
    return (str(x or "")
            .strip()
            .lower()
            .encode('utf-8', 'ignore')
            .decode('utf-8'))

def _first_non_empty_ci(d: dict | None, *keys, default=None):
    """Renvoie la première valeur non vide pour l'une des clés (recherche insensible à la casse)."""
    if not isinstance(d, dict):
        return default
    low = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        v = low.get(str(k).lower())
        if v not in (None, "", " "):
            return v
    return default

def _mode_token(mode_raw: str, reseau_raw: str | None = None, code_raw: str | None = None) -> str | None:
    s = _ascii_lower(mode_raw)
    r = _ascii_lower(reseau_raw)
    c = _ascii_lower(code_raw)
    txt = " ".join(v for v in [s, r, c] if v)

    # 👉 Ajout: détection explicite du TRAM
    if "tram" in txt or re.search(r"\bt\s*\d{1,2}[ab]?\b", txt):
        return "tram"

    if "rer" in txt:
        return "rer"
    if "metro" in txt or "métro" in txt or re.search(r"\bm\d+\b", txt):
        return "metro"
    if "transilien" in txt or ("sncf" in txt and "rer" not in txt):
        return "transilien"
    if re.search(r"\bter\b", txt):
        return "ter"
    if "tgv" in txt:
        return "tgv"
    if re.search(r"\brer\s*[a-e]\b", txt):
        return "rer"
    if re.search(r"\bm\s*\d{1,2}\b", txt):
        return "metro"
    return None

# --- Regex pour les lignes ---
_LINE_NUM_RE = re.compile(r"(?:\b(?:ligne|lin|l)\s*|^)\s*([0-9]{1,2})\b", re.I)
_LINE_M_RE   = re.compile(r"\bm\s*([0-9]{1,2})\b", re.I)
_LINE_RER_RE = re.compile(r"\brer\s*([A-E])\b", re.I)
_LINE_LETTER = re.compile(r"\b([HJLNPUKR])\b", re.I)      # Transilien
_LINE_TRAM   = re.compile(r"\bT\s*([0-9]{1,2}[a-b]?)\b", re.I)

def _parse_line_from_text(txt: str, mode: str | None) -> str | None:
    if not txt:
        return None
    t = str(txt)

    m = _LINE_RER_RE.search(t)
    if m: return m.group(1).upper()

    # Métro / nombre isolé
    m = _LINE_M_RE.search(t)
    if m and (mode == "metro" or not mode):
        return m.group(1)
    m = _LINE_NUM_RE.search(t)
    if m and (mode == "metro" or not mode):
        return m.group(1)

    m = _LINE_TRAM.search(t)
    if m:
        return f"T{m.group(1)}"

    m = _LINE_LETTER.search(t)
    if m and (mode == "transilien" or not mode):
        return m.group(1).upper()

    return None

def _extract_line(props: dict, mode: str | None, name_fallback: str | None = None) -> str | None:
    # 1) Champs directs typiques
    direct = _first_non_empty_ci(
        props,
        "route_short_name", "short_name", "shortname",
        "ligne", "line", "num_ligne", "num_lig", "code_ligne", "id_ligne",
        "idref_ligne", "code", "code_lig", "route", "route_id"
    )
    if isinstance(direct, (str, int)):
        val = str(direct).strip()
        # Ajustements par mode
        if mode == "metro":
            m = _parse_line_from_text(val, mode)
            if m: return m
            if re.fullmatch(r"\d{1,2}", val):
                return val
        if mode == "rer":
            m = re.fullmatch(r"[A-E]", val.upper())
            if m: return m.group(0)
        if mode == "transilien":
            m = re.fullmatch(r"[HJLNPUKR]", val.upper())
            if m: return m.group(0)
        if mode == "tram":
            m = _LINE_TRAM.search(val.upper())
            if m: return f"T{m.group(1)}"
        m = _parse_line_from_text(val, mode)
        if m: return m

    # 2) Nom de la gare (ex: "M8 Maisons-Alfort – Le Stade", "RER A La Défense")
    name_txt = _first_non_empty_ci(
        props,
        "name", "nom", "nom_gare", "nomlong", "nom_long",
        "nom_zdl", "libelle", "label", "stop_name", "station_name", "gare"
    ) or name_fallback
    if name_txt:
        m = _parse_line_from_text(str(name_txt), mode)
        if m: return m

    # 3) Blobs descriptifs (reseau contient souvent "RER A" / "M 8")
    blob = " ".join(str(_first_non_empty_ci(props, k, default="")) for k in [
        "reseau", "reseaufr", "network",
        "route_long_name", "route_desc", "desc", "commentaire"
    ])
    m = _parse_line_from_text(blob, mode)
    if m: return m

    return None

def _records_to_stations(data):
    out = []
    for rec in (data or {}).get("results", []):
        geom = rec.get("geometry") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not (isinstance(coords, (list, tuple)) and len(coords) >= 2):
            continue
        lon, lat = coords[0], coords[1]
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            continue

        fields = rec.get("fields", {}) or {}

        # 🔧 Nom : on ratisse large (name/stop_name/station_name/nom/nom_gare/…)
        name = (
            _first_non_empty_ci(
                fields,
                "name", "stop_name", "station_name",
                "nom", "nom_gare", "nomlong", "nom_long", "nom_zdl",
                "libelle", "label", "nomcourt", "gare"
            )
            or _first_non_empty_ci(rec, "name", "nom", "libelle")
            or "Gare"
        )

        # Mode + ligne (robuste)
        raw_mode   = _first_non_empty_ci(fields, "mode", "mode_", "transport", "type")
        raw_reseau = _first_non_empty_ci(fields, "reseau", "reseaufr", "network")
        raw_code   = _first_non_empty_ci(fields, "route_short_name", "short_name", "shortname", "code", "ligne", "line")
        mode = _mode_token(str(raw_mode or ""), str(raw_reseau or ""), str(raw_code or ""))
        if not mode:
            mode = _mode_token("", "", str(_first_non_empty_ci(fields, "ligne", "commentaire") or ""))
        if not mode:
            continue

        line = _extract_line(fields or {}, mode, name)

        typ = "Station" if mode == "metro" else ("Station" if mode == "tram" else "Gare")
        out.append({"name": str(name), "type": typ, "mode": mode, "line": line, "lat": lat, "lon": lon})
    return out

def _export_to_stations(gj):
    feats = gj.get("features", []) if isinstance(gj, dict) else []
    out = []
    for ft in feats:
        geom = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not (isinstance(coords, (list, tuple)) and len(coords) >= 2):
            continue
        lon, lat = coords[0], coords[1]
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            continue

        # 🔧 Nom : idem records
        name = (
            _first_non_empty_ci(
                props,
                "name", "stop_name", "station_name",
                "nom", "nom_gare", "nomlong", "nom_long", "nom_zdl",
                "libelle", "label", "nomcourt", "gare"
            )
            or "Gare"
        )

        raw_mode   = _first_non_empty_ci(props, "mode", "mode_", "transport", "type")
        raw_reseau = _first_non_empty_ci(props, "reseau", "reseaufr", "network")
        raw_code   = _first_non_empty_ci(props, "route_short_name", "short_name", "shortname", "code", "ligne", "line")
        mode = _mode_token(str(raw_mode or ""), str(raw_reseau or ""), str(raw_code or ""))
        if not mode:
            mode = _mode_token("", "", str(_first_non_empty_ci(props, "ligne", "commentaire") or ""))
        if not mode:
            continue

        line = _extract_line(props or {}, mode, name)

        typ = "Station" if mode == "metro" else ("Station" if mode == "tram" else "Gare")
        out.append({"name": str(name), "type": typ, "mode": mode, "line": line, "lat": lat, "lon": lon})
    return out

def build_stations():
    print("Télécharge les gares/stations IDFM…")
    out = []

    # 0) Local file (si présent)
    if os.path.exists(LOCAL_STATIONS_SOURCE):
        try:
            gj = load_local_json(LOCAL_STATIONS_SOURCE)
            out = _export_to_stations(gj)
            if out:
                print(f"  -> via fichier local: {len(out)}")
        except Exception as e:
            print(f"  (local) échec: {e}")

    # 1) API records
    if not out:
        try:
            data = get_json(IDFM_RECORDS)
            out = _records_to_stations(data)
            if out:
                print(f"  -> via records: {len(out)}")
        except Exception as e:
            print(f"  (records) échec: {e}")

    # 2) Endpoint download (souvent plus permissif)
    if not out:
        try:
            gj = get_json(IDFM_DOWNLOAD)
            out = _export_to_stations(gj)
            if out:
                print(f"  -> via download: {len(out)}")
        except Exception as e:
            print(f"  (download) échec: {e}")

    # 3) Export geojson (dernier recours)
    if not out:
        try:
            gj = get_json(IDFM_EXPORT)
            out = _export_to_stations(gj)
            if out:
                print(f"  -> via export: {len(out)}")
        except Exception as e:
            print(f"  (export) échec: {e}")

    if not out:
        print("  !! Impossible de récupérer les gares/stations.")
        print("     -> Solution rapide : ouvre cette URL dans ton navigateur :")
        print("        ", IDFM_DOWNLOAD)
        print(f"        Enregistre le fichier comme {LOCAL_STATIONS_SOURCE} puis relance le build.")
        with open("data/stations.min.json","w",encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, separators=(",",":"))
        return

    # --- Post-traitement: formater le nom en PRÉFIXE (ex: 'RER A La Défense', 'Métro 8 ...') ---
    for r in out:
        base = str(r.get("name") or "").strip()
        mode = str(r.get("mode") or "").lower()
        line = str(r.get("line") or "").strip()

        prefix = ""
        if mode == "metro" and line:
            prefix = f"Métro {line}"
        elif mode == "rer" and line:
            prefix = f"RER {line}"
        elif mode == "tram" and line:
            prefix = f"Tram {line.replace('T','')}"
        elif mode == "transilien" and line:
            prefix = f"Transilien {line}"
        elif mode in ("ter", "tgv") and line:
            prefix = f"{mode.upper()} {line}"

        # Nom final + label cohérent
        if prefix:
            r["name"] = f"{prefix} {base}" if base else prefix
        else:
            r["name"] = base
        r["label"] = r["name"]

    out.sort(key=lambda r: (r.get("mode",""), r.get("name","")))
    with open("data/stations.min.json","w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    # Evite un 304 si la rebuild tombe dans la même seconde
    os.utime("data/stations.min.json", None)
    print(f"OK: data/stations.min.json ({len(out)} gares/stations)")

# ---------------- main ----------------
if __name__ == "__main__":
    build_establishments()
    build_ips()
    build_gazetteer()
    build_stations()
    print("Terminé.")
