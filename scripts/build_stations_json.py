# scripts/build_stations_json.py
import sys, json, csv, os
from collections import Counter

def norm_mode(s: str | None):
    s = (s or "").strip().upper()
    # normalisation principale
    if s.startswith("METRO") or s == "VAL": return "metro"
    if s.startswith("RER"):                return "rer"
    if s.startswith("TRAM"):               return "tram"
    if s in {"TER", "INTERCITES", "INTERCITÉS", "IC"}: return "intercites"
    if s == "TGV":                         return "tgv"
    if s.startswith("TRAIN"):              return "transilien"  # IDF
    # sinon on garde tel quel (sncf open data peut donner déjà ter/tgv)
    return s.lower()

def norm_line(raw, mode):
    if raw is None: return None
    S = str(raw).strip().upper()
    if not S: return None
    if mode == "metro":
        for k in ("MÉTRO","METRO","M","LIGNE"):
            if S.startswith(k): S = S[len(k):].strip()
        return S.replace(" ","")
    if mode == "rer":
        return S.replace("RER","").strip()[:1]  # A/B/C/D/E
    if mode == "tram":
        S = S.replace("TRAM","T").strip()
        return S if S.startswith("T") else "T"+S
    # TER / INTERCITES / TGV : pas de code ligne pertinent => None
    if mode in ("intercites","tgv"): 
        if S in {"IC","INTERCITES","INTERCITÉS","TGV"}: return None
    return S or None

def from_geojson(path):
    with open(path, encoding="utf-8") as f:
        g = json.load(f)
    out=[]
    for ft in g.get("features", []):
        p = ft.get("properties", {})
        geom = ft.get("geometry") or {}
        if (geom.get("type") != "Point") or not geom.get("coordinates"): 
            continue
        lon, lat = geom["coordinates"][:2]

        # champs fréquents (IDFM + SNCF)
        name = p.get("nom_gares") or p.get("nom_iv") or p.get("libelle") \
            or p.get("name") or p.get("nom") or p.get("intitule") or "—"
        raw_mode = p.get("mode") or p.get("reseau") or p.get("type") or p.get("mode_transport")
        mode = norm_mode(raw_mode)

        raw_line = p.get("indice_lig") or p.get("idrefliga") or p.get("route_short_name") \
            or p.get("libelle_ligne") or p.get("ligne")
        line = norm_line(raw_line, mode)

        out.append({
            "name": name,
            "type": "Station" if mode in ("metro","tram") else "Gare",
            "mode": mode, "line": line,
            "lat": float(lat), "lon": float(lon),
            "label": name
        })
    return out

def sniff_delimiter(sample):
    try:
        return csv.Sniffer().sniff(sample).delimiter
    except:
        return ";" if ";" in sample else ","

def from_csv(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        sample = f.read(4096); f.seek(0)
        delim = sniff_delimiter(sample)
        r = csv.DictReader(f, delimiter=delim)
        out=[]
        for row in r:
            name = (row.get("name") or row.get("nom") or row.get("station")
                    or row.get("stop_name") or row.get("label") or "—")
            raw_mode = row.get("mode") or row.get("reseau") or row.get("transport") \
                       or row.get("route_type_name")
            mode = norm_mode(raw_mode)
            raw_line = row.get("line") or row.get("ligne") or row.get("route_short_name") \
                       or row.get("code_ligne")
            line = norm_line(raw_line, mode)
            lat  = row.get("lat") or row.get("latitude") or row.get("y") or row.get("stop_lat")
            lon  = row.get("lon") or row.get("longitude") or row.get("x") or row.get("stop_lon")
            try:
                lat = float(lat); lon = float(lon)
            except:
                continue
            out.append({
                "name": name,
                "type": "Station" if mode in ("metro","tram") else "Gare",
                "mode": mode, "line": line, "lat": lat, "lon": lon,
                "label": name
            })
    return out

def load_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".geojson",".json"): return from_geojson(path)
    return from_csv(path)

if len(sys.argv) < 3:
    print("Usage: python3 build_stations_json.py <in1.[geo]json/csv> [in2 ...] <out.json>")
    sys.exit(2)

OUT = sys.argv[-1]
inputs = sys.argv[1:-1]

rows=[]
for p in inputs:
    rows.extend(load_any(p))

# dédoublonnage simple par (name, mode, arrondi coord.)
seen=set(); unique=[]
for r in rows:
    key=(r["name"].strip().lower(), r["mode"], round(r["lat"],6), round(r["lon"],6))
    if key in seen: continue
    seen.add(key); unique.append(r)

with open(OUT, "w", encoding="utf-8") as w:
    json.dump(unique, w, ensure_ascii=False, separators=(",",":"))

print(f"OK -> {OUT}  ({len(unique)} points)  par mode: {Counter(r['mode'] for r in unique)}")
