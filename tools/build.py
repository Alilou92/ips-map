#!/usr/bin/env python3
import os, json, math, time, sys
import urllib.request, urllib.parse

BASE_V21 = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/"
DS_GEO   = "fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre"
DS_IPS = {
  "ecole":   "fr-en-ips-ecoles-ap2022",
  "college": "fr-en-ips-colleges-ap2023",
  "lycee":   "fr-en-ips-lycees-ap2023"
}

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(OUT_DIR, exist_ok=True)

def fetch_json(url):
  with urllib.request.urlopen(url) as r:
    return json.loads(r.read().decode("utf-8"))

def paged_fetch(dataset, select="*", where=None, limit=10000):
  out = []
  offset = 0
  while True:
    params = {"select": select, "limit": str(limit), "offset": str(offset)}
    if where:
      params["where"] = where
    url = BASE_V21 + dataset + "/records?" + urllib.parse.urlencode(params, safe="()*=,. '")
    js = fetch_json(url)
    rows = js.get("results", [])
    out.extend(rows)
    if len(rows) < limit: break
    offset += limit
    time.sleep(0.2)
  return out

def norm_type(fields):
  v = (fields.get("libelles_nature") or fields.get("nature_uai_libe") or "").upper()
  if "LYCEE" in v: return "lycee"
  if "COLLEGE" in v: return "college"
  if "ECOLE" in v: return "ecole"
  # piste 2 : appellation
  w = (fields.get("appellation_officielle") or fields.get("denomination_principale") or "").upper()
  if "LYC" in w: return "lycee"
  if "COLL" in w: return "college"
  if "ECOLE" in w or "MATERNELLE" in w or "ELEMENTAIRE" in w: return "ecole"
  return None

def norm_secteur(fields):
  s = (fields.get("secteur") or fields.get("secteur_public_prive") or "").lower()
  if s.startswith("pub") or s=="pu": return "Public"
  if s.startswith("priv") or s=="pr": return "Privé"
  t = (fields.get("secteur_prive_libelle_type_contrat") or "").lower()
  if t: return "Privé"
  return "—"

def as_float(x):
  try: return float(x)
  except: return None

def build_establishments():
  print("Télécharge annuaire géolocalisé…", file=sys.stderr)
  rows = paged_fetch(DS_GEO, select="*")
  out = []
  for f in rows:
    lat = None; lon = None
    # différents champs possibles
    if isinstance(f.get("wgs84"), dict):
      lat = as_float(f["wgs84"].get("lat")); lon = as_float(f["wgs84"].get("lon"))
    if (lat is None or lon is None) and isinstance(f.get("geo_point_2d"), dict):
      lat = as_float(f["geo_point_2d"].get("lat")); lon = as_float(f["geo_point_2d"].get("lon"))
    if (lat is None or lon is None) and isinstance(f.get("geopoint"), dict):
      lat = as_float(f["geopoint"].get("lat")); lon = as_float(f["geopoint"].get("lon"))
    if lat is None or lon is None: continue

    uai = f.get("numero_uai") or f.get("uai") or f.get("code_uai")
    if not uai: continue

    dep = f.get("code_du_departement") or f.get("code_departement")
    cp  = f.get("code_postal_uai") or f.get("code_postal") or f.get("adresse_code_postal")
    com = f.get("nom_de_la_commune") or f.get("commune") or f.get("libelle_commune")
    name = f.get("appellation_officielle") or f.get("nom_etablissement") or f.get("nom_de_l_etablissement") or f.get("denomination_principale") or "Établissement"
    typ = norm_type(f)
    sect = norm_secteur(f)

    if not typ: continue
    out.append({
      "uai": uai, "type": typ, "secteur": sect,
      "lat": lat, "lon": lon,
      "dep": str(dep) if dep is not None else "",
      "cp": str(cp) if cp is not None else "",
      "commune": com or "",
      "name": name
    })

  out_path = os.path.join(OUT_DIR, "establishments.min.json")
  with open(out_path, "w", encoding="utf-8") as w:
    json.dump(out, w, ensure_ascii=False, separators=(",",":"))
  print(f"OK: {out_path} ({len(out)} établissements)", file=sys.stderr)

def build_ips():
  ips_map = {}
  for key, ds in DS_IPS.items():
    print(f"Télécharge IPS {key}…", file=sys.stderr)
    rows = paged_fetch(ds, select="*")
    # garde la dernière rentrée (si champ dispo)
    # sinon, prend tout (dans ces jeux il n’y a qu’une année)
    best_year = None
    for r in rows:
      y = r.get("rentree_scolaire") or r.get("annee_scolaire") or r.get("annee")
      try:
        y = int(y)
        if best_year is None or y>best_year: best_year=y
      except: pass
    for r in rows:
      y = r.get("rentree_scolaire") or r.get("annee_scolaire") or r.get("annee")
      if best_year and y and str(y)!=str(best_year): continue
      uai = r.get("uai") or r.get("code_uai")
      ips = r.get("ips") or r.get("indice_position_sociale") or r.get("indice") or r.get("ips_moyen")
      if not uai: continue
      try:
        ips_map[uai] = float(ips)
      except:
        pass

  out_path = os.path.join(OUT_DIR, "ips.min.json")
  with open(out_path, "w", encoding="utf-8") as w:
    json.dump(ips_map, w, ensure_ascii=False, separators=(",",":"))
  print(f"OK: {out_path} ({len(ips_map)} UAI avec IPS)", file=sys.stderr)

def build_gazetteer():
  print("Télécharge gazetteer communes…", file=sys.stderr)
  url = "https://geo.api.gouv.fr/communes?fields=centre,nom,code,codesPostaux,departement&format=json&geometry=centre&limit=50000"
  arr = fetch_json(url)
  out = []
  for c in arr:
    cps = c.get("codesPostaux") or []
    ctr = c.get("centre") or {}
    coords = ctr.get("coordinates") or []
    if len(coords)>=2:
      lon,lat = coords[0], coords[1]
    else:
      lat=lon=None
    dep = ""
    if isinstance(c.get("departement"), dict):
      dep = c["departement"].get("code","")
    out.append({
      "name": c.get("nom",""),
      "dep": dep,
      "cps": cps,
      "lat": lat,
      "lon": lon
    })
  out_path = os.path.join(OUT_DIR, "gazetteer.min.json")
  with open(out_path, "w", encoding="utf-8") as w:
    json.dump(out, w, ensure_ascii=False, separators=(",",":"))
  print(f"OK: {out_path} ({len(out)} communes)", file=sys.stderr)

if __name__=="__main__":
  build_establishments()
  build_ips()
  build_gazetteer()
  print("Terminé.", file=sys.stderr)
