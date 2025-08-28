#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Build statique pour ips-map (version v7 stable)
- Établissements géolocalisés: API v1 + refine par département, pagination
- IPS: exports v2.1 (complets)
- Gazetteer: geo.api.gouv.fr (centres des communes)
"""

import json, sys, time, urllib.parse, urllib.request

BASE_V1  = "https://data.education.gouv.fr/api/records/1.0/search/"
BASE_V21 = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets"

HEADERS  = {"User-Agent":"ips-map build v7", "Accept":"application/json"}

# Jeux
DS_GEOLOC = "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre"
DS_IPS = {
    "ecole":   "fr-en-ips-ecoles-ap2022",
    "college": "fr-en-ips-colleges-ap2023",
    "lycee":   "fr-en-ips-lycees-ap2023",
}

# Sorties
OUT_ESTABS = "data/establishments.min.json"
OUT_IPS    = "data/ips.min.json"
OUT_GAZ    = "data/gazetteer.min.json"

# Départements (métropole + Corse + DOM principaux)
DEPS = [f"{i:02d}" for i in range(1, 96)] + ["2A","2B","971","972","973","974","976"]

def http_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))

# ----------------- ÉTABLISSEMENTS via API v1 + refine + pagination -----------------
def fetch_geoloc_dep(dep_code, rows_per_page=1000, sleep=0.08):
    """
    Récupère TOUTES les lignes géolocalisées d'un département via API v1:
    - Essaye refine.code_du_departement=dep_code ; si 0 résultat, essaye refine.code_departement=dep_code
    - Pagine avec start=0,1000,2000,... jusqu'à records==0
    Retourne la liste des 'fields'.
    """
    results = []
    for field in ("code_du_departement", "code_departement"):
        start = 0
        count_for_field = 0
        while True:
            params = {
                "dataset": DS_GEOLOC,
                "rows": str(rows_per_page),
                "start": str(start),
                f"refine.{field}": dep_code,
            }
            # on ajoute quelques facets pour stabiliser le mapping des champs (facultatif)
            for fac in ("secteur","libelles_nature","nature_uai_libe"):
                params.setdefault("facet", fac)
            qs = urllib.parse.urlencode(params, doseq=True, quote_via=urllib.parse.quote)
            url = f"{BASE_V1}?{qs}"
            try:
                js = http_json(url)
            except Exception:
                # réseau: on sort de ce field
                break
            recs = js.get("records", []) or []
            if not recs:
                break
            for rec in recs:
                f = rec.get("fields", {})
                if f:
                    results.append(f)
                    count_for_field += 1
            start += rows_per_page
            time.sleep(sleep)
        if count_for_field:
            print(f"  • Département {dep_code} via {field}: {count_for_field} lignes")
            return results
    print(f"  ! Département {dep_code}: 0 lignes (aucune variante de champ)")
    return results

def extract_latlon(f):
    """
    Décode lat/lon à partir de divers formats.
    - dict {lat,lon}
    - array [lon,lat] (ODS) ou [lat,lon] → on détecte.
    """
    def try_array(a):
        if not (isinstance(a, (list, tuple)) and len(a) >= 2):
            return None, None
        x, y = float(a[0]), float(a[1])
        # si x ressemble à lon (-180..180) et y à lat (-90..90) → (lat,lon)=(y,x)
        if -180.0 <= x <= 180.0 and -90.0 <= y <= 90.0:
            return y, x
        # sinon inverse
        if -90.0 <= x <= 90.0 and -180.0 <= y <= 180.0:
            return x, y
        return None, None

    for k in ("wgs84","geo_point_2d","geopoint","geolocalisation","position","coordonnees"):
        v = f.get(k)
        if isinstance(v, dict) and "lat" in v and "lon" in v:
            try:
                return float(v["lat"]), float(v["lon"])
            except: pass
        if isinstance(v, (list, tuple)):
            lt, ln = try_array(v)
            if lt is not None and ln is not None:
                return lt, ln
    return None, None

def detect_type(f):
    lib = (f.get("libelles_nature")
           or f.get("nature_uai_libe")
           or f.get("nature_uai_libelle")
           or f.get("nature_uai_lib")
           or "")
    u = str(lib).upper()
    if "ECOLE" in u or "ÉCOLE" in u: return "ecole"
    if "COLLEGE" in u or "COLLÈGE" in u: return "college"
    if "LYCEE" in u or "LYCÉE" in u: return "lycee"
    code_nat = str(f.get("nature_uai","")).strip()
    if code_nat.isdigit():
        n = int(code_nat)
        if 100 <= n <= 199: return "ecole"
        if 300 <= n <= 399: return "lycee" if n >= 350 else "college"
    return None

def norm_secteur(f):
    s = (f.get("secteur") or f.get("secteur_public_prive") or f.get("statut_public_prive") or "").lower()
    if s.startswith("pub") or s == "pu": return "Public"
    if s.startswith("priv") or s == "pr": return "Privé"
    t = (f.get("secteur_prive_libelle_type_contrat") or "").lower()
    if t: return "Privé"
    return "—"

def build_establishments():
    print("Établissements géolocalisés (API v1 + refine + pagination)")
    all_fields = []
    for dep in DEPS:
        all_fields.extend(fetch_geoloc_dep(dep))

    out = []
    seen = set()
    for f in all_fields:
        uai = f.get("numero_uai") or f.get("uai") or f.get("code_uai")
        if not uai or uai in seen:
            continue
        etype = detect_type(f)
        if etype not in ("ecole","college","lycee"):
            continue
        lat, lon = extract_latlon(f)
        if lat is None or lon is None:
            continue
        name = (f.get("appellation_officielle")
                or f.get("nom_etablissement")
                or f.get("nom_de_l_etablissement")
                or f.get("denomination_principale")
                or "Établissement")
        commune = (f.get("libelle_commune")
                   or f.get("nom_de_la_commune")
                   or f.get("commune")
                   or f.get("nom_commune")
                   or "")
        dep = (f.get("code_departement")
               or f.get("code_du_departement")
               or "")
        out.append({
            "uai": uai,
            "type": etype,
            "name": name,
            "commune": commune,
            "secteur": norm_secteur(f),
            "dep": str(dep),
            "lat": round(lat,6),
            "lon": round(lon,6),
        })
        seen.add(uai)

    with open(OUT_ESTABS, "w", encoding="utf-8") as w:
        json.dump(out, w, ensure_ascii=False, separators=(",",":"))
    print(f"OK: {OUT_ESTABS} ({len(out)} établissements)")

# ----------------- IPS via export v2.1 -----------------
def export_json_url(dataset):
    return f"{BASE_V21}/{dataset}/exports/json"

def build_ips():
    print("IPS (exports v2.1)")
    ips = {}
    for key, ds in DS_IPS.items():
        print(f"  • {key}")
        arr = http_json(export_json_url(ds))   # <-- on récupère déjà du JSON parsé
        if isinstance(arr, dict) and "results" in arr:
            # par sécurité : certains exports renvoient 'results'
            arr = arr.get("results", [])
        for row in arr:
            uai = row.get("uai") or row.get("code_uai")
            if not uai: continue
            val = (row.get("ips")
                   or row.get("indice_position_sociale")
                   or row.get("indice"))
            try:
                v = None if val in (None,"") else float(val)
            except:
                v = None
            if v is not None:
                ips[uai] = round(v,1)
        time.sleep(0.12)

    with open(OUT_IPS, "w", encoding="utf-8") as w:
        json.dump(ips, w, ensure_ascii=False, separators=(",",":"))
    print(f"OK: {OUT_IPS} ({len(ips)} UAI avec IPS)")

# ----------------- Gazetteer -----------------
def build_gazetteer():
    print("Gazetteer communes…")
    url = "https://geo.api.gouv.fr/communes?fields=nom,centre,codesPostaux&format=json&geometry=centre"
    arr = http_json(url)
    out = []
    for c in arr:
        nom = c.get("nom")
        cp  = c.get("codesPostaux") or []
        cen = (c.get("centre") or {}).get("coordinates")
        if nom and isinstance(cen, list) and len(cen) == 2:
            lon, lat = float(cen[0]), float(cen[1])
            out.append({"n": nom, "cp": cp[:3], "lat": round(lat,6), "lon": round(lon,6)})
    with open(OUT_GAZ, "w", encoding="utf-8") as w:
        json.dump(out, w, ensure_ascii=False, separators=(",",":"))
    print(f"OK: {OUT_GAZ} ({len(out)} communes)")

# ----------------- MAIN -----------------
if __name__ == "__main__":
    try:
        build_establishments()
        build_ips()
        build_gazetteer()
        print("Terminé.")
    except Exception as e:
        print("[ERREUR]", e)
        sys.exit(1)
