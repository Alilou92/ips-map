#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# -----------------------------------------------------------------------------
# build_stations.py (v2)
# - Découverte du GTFS IDFM via data.gouv (ou IDFM_GTFS_URL fichier/URL)
# - Parse GTFS et déduit (mode, line) de façon stricte
# - Exporte data/stations.min.json : [{name, mode, line, lat, lon, colorHex?}]
# -----------------------------------------------------------------------------

import os, re, io, csv, sys, json, zipfile, datetime
from collections import defaultdict
from typing import Dict, List, Set, Tuple, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

DATASET_SLUG = os.environ.get(
    "DATAGOUV_DATASET_SLUG",
    "reseau-urbain-et-interurbain-dile-de-france-mobilites"
)
IDFM_GTFS_URL = os.environ.get("IDFM_GTFS_URL", "").strip()

# ---------- util HTTP / découverte data.gouv ----------

def http_get_json(url: str):
    req = Request(url, headers={"User-Agent": "ips-map-builder/1.0"})
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def discover_latest_zip(slug: str) -> Optional[str]:
    api = f"https://www.data.gouv.fr/api/1/datasets/{slug}/"
    try:
        data = http_get_json(api)
    except Exception as e:
        print(f"[data.gouv] Échec API dataset: {e}")
        return None

    resources = data.get("resources") or []
    best: Tuple[datetime.datetime, str] | None = None
    for res in resources:
        url = (res.get("url") or "").strip()
        fmt = (res.get("format") or "").lower()
        mime = (res.get("mime") or "").lower()
        txt  = ((res.get("title") or "") + " " + (res.get("description") or "")).lower()

        looks_gtfs = (
            "gtfs" in fmt or "gtfs" in mime or "gtfs" in txt
            or (url.endswith(".zip") and ("gtfs" in url.lower() or "offre-transport" in url.lower()))
        )
        if not url or not url.endswith(".zip") or not looks_gtfs:
            continue

        when = res.get("last_modified") or res.get("created_at") or ""
        try:
            dt = datetime.datetime.fromisoformat(when.replace("Z","+00:00"))
        except Exception:
            dt = datetime.datetime.min

        if best is None or dt > best[0]:
            best = (dt, url)

    if not best:
        print("[data.gouv] Aucune ressource GTFS zip trouvée.")
        return None

    print(f"[data.gouv] GTFS sélectionné : {best[1]}")
    return best[1]

def download_bytes(url_or_path: str) -> bytes:
    if not url_or_path:
        raise ValueError("URL/chemin vide")

    if url_or_path.startswith("file://"):
        p = os.path.expanduser(url_or_path[7:])
        with open(p, "rb") as f: return f.read()

    p = os.path.expanduser(url_or_path)
    if os.path.exists(p):
        with open(p, "rb") as f: return f.read()

    req = Request(url_or_path, headers={"User-Agent":"ips-map-builder/1.0"})
    try:
        with urlopen(req, timeout=120) as r:
            return r.read()
    except HTTPError as e:
        raise RuntimeError(f"Téléchargement en échec ({e.code}) : {url_or_path}") from e
    except URLError as e:
        raise RuntimeError(f"Téléchargement en échec : {url_or_path} ({e})") from e

# ---------- helpers normalisation ----------

def parse_color_hex(s: str | None) -> Optional[str]:
    if not s: return None
    s = str(s).strip()
    m = re.match(r"^#?([0-9A-Fa-f]{6})$", s);     if m: return f"#{m.group(1).upper()}"
    m = re.match(r"^0x([0-9A-Fa-f]{6})$", s);     if m: return f"#{m.group(1).upper()}"
    m = re.match(r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})", s, re.I)
    if m:
        to2 = lambda x: f"{max(0,min(255,int(x))):02X}"
        return f"#{to2(m.group(1))}{to2(m.group(2))}{to2(m.group(3))}"
    return None

def norm_name(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s: return "Gare"
    s = re.sub(r"\bGare(?:\s+SNCF)?\s+(?:de|d’|d'|du|des)\s+", "", s, flags=re.I)
    s = re.sub(r"^Gare\s+", "", s, flags=re.I)
    s = re.sub(r"\s*\((?:RER|SNCF|Transilien|Métro|Metro|Tram|IDFM)[^)]+\)\s*", " ", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*RER\s+[A-E]\b", "", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*Ligne\s+[A-Z0-9]+$", "", s, flags=re.I)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s or "Gare"

def classify_route_and_line(short: str, long: str, route_type: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Retourne (mode, line) en priorisant les motifs de nom (robuste pour IDFM).
    """
    s = (short or "").upper().strip()
    l = (long  or "").upper().strip()
    rt = (route_type or "").strip()

    # ——— RER ———
    m = re.search(r"\bRER\s*([A-E])\b", s) or re.search(r"\bRER\s*([A-E])\b", l)
    if m:
        return ("rer", m.group(1))

    # ——— Métro ———
    m = re.search(r"^(?:M|METRO|MÉTRO|LIGNE)?\s*(3BIS|7BIS|\d{1,2})$", s)
    if not m: m = re.search(r"\b(?:M|METRO|MÉTRO|LIGNE)\s*(3BIS|7BIS|\d{1,2})\b", l)
    if m:
        return ("metro", m.group(1))

    # ——— Tram ———
    m = re.search(r"^(?:T)?\s*(\d{1,2}[AB]?)$", s)
    if not m: m = re.search(r"\bT\s*(\d{1,2}[AB]?)\b", l) or re.search(r"\bTRAM\s*(\d{1,2}[AB]?)\b", l)
    if m:
        return ("tram", f"T{m.group(1)}")

    # ——— Transilien ———
    m = re.fullmatch(r"[HJKLNRPU]", s)
    if not m:
        m = re.search(r"\bTRANSILIEN\s+([HJKLNRPU])\b", l)
    if m:
        return ("transilien", m.group(1))

    # ——— TER / TGV ———
    if "TER" in s or "TER" in l:
        return ("ter", None)
    if "TGV" in s or "TGV" in l:
        return ("tgv", None)

    # ——— Fallback prudent sur route_type (éviter les faux TN) ———
    if rt == "1":   # subway
        return ("metro", None)
    if rt == "0":   # tram
        return ("tram", None)
    # rt == "2" = rail : on NE classe PAS par défaut (évite faux "TN")
    return (None, None)

# ---------- lecture GTFS ----------

def read_csv_from_zip(zf: zipfile.ZipFile, names: List[str]) -> List[Dict[str, str]]:
    namemap = {n.lower(): n for n in zf.namelist()}
    for cand in names:
        if cand.lower() in namemap:
            with zf.open(namemap[cand.lower()], "r") as f:
                data = f.read().decode("utf-8", errors="replace")
            return [row for row in csv.DictReader(io.StringIO(data))]
    return []

def build_entries(gtfs_bytes: bytes) -> List[Dict[str, object]]:
    zf = zipfile.ZipFile(io.BytesIO(gtfs_bytes), "r")

    routes_rows = read_csv_from_zip(zf, ["routes.txt"])
    routes: Dict[str, Dict[str, str]] = {}
    for r in routes_rows:
        rid = (r.get("route_id") or "").strip()
        if rid:
            routes[rid] = {
                "short": (r.get("route_short_name") or "").strip(),
                "long":  (r.get("route_long_name")  or "").strip(),
                "type":  (r.get("route_type")       or "").strip(),
                "color": (r.get("route_color")      or "").strip(),
            }

    stops_rows = read_csv_from_zip(zf, ["stops.txt"])
    stops: Dict[str, Dict[str, str]] = { (s.get("stop_id") or "").strip(): s for s in stops_rows if (s.get("stop_id") or "").strip() }
    parent_of: Dict[str, str] = {}
    children_of: Dict[str, List[str]] = defaultdict(list)
    stations: Set[str] = set()
    for sid, s in stops.items():
        lt = (s.get("location_type") or "").strip()
        p  = (s.get("parent_station") or "").strip()
        if p:
            parent_of[sid] = p
            children_of[p].append(sid)
        if lt == "1":
            stations.add(sid)

    trips_rows = read_csv_from_zip(zf, ["trips.txt"])
    trip_to_route: Dict[str, str] = {}
    for t in trips_rows:
        tid = (t.get("trip_id") or "").strip()
        rid = (t.get("route_id") or "").strip()
        if tid and rid:
            trip_to_route[tid] = rid

    stop_times = read_csv_from_zip(zf, ["stop_times.txt"])
    stop_to_routes: Dict[str, Set[str]] = defaultdict(set)
    for st in stop_times:
        sid = (st.get("stop_id") or "").strip()
        tid = (st.get("trip_id") or "").strip()
        if sid and tid and tid in trip_to_route:
            stop_to_routes[sid].add(trip_to_route[tid])

    station_routes: Dict[str, Set[str]] = defaultdict(set)
    for sid in stops.keys():
        # destination = parent station si possible
        dest = None
        p = parent_of.get(sid)
        if p and (stops.get(p, {}).get("location_type") or "") == "1":
            dest = p
        elif sid in stations:
            dest = sid
        else:
            dest = sid

        station_routes[dest].update(stop_to_routes.get(sid, set()))

    # s’assurer que toutes les stations existent (même sans routes)
    for stid in stations:
        station_routes.setdefault(stid, set())

    out: List[Dict[str, object]] = []
    seen: Set[Tuple[str, str, Optional[str], float, float]] = set()

    for stid, rids in station_routes.items():
        s = stops.get(stid, {})
        # coordonnées station, sinon 1er enfant
        def coo(row):
            return row.get("stop_lat") or row.get("stop_lat_wgs84") or row.get("lat"), \
                   row.get("stop_lon") or row.get("stop_lon_wgs84") or row.get("lon")
        lat, lon = coo(s)
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            lat = lon = None
            for child in children_of.get(stid, []):
                la, lo = coo(stops.get(child, {}))
                try:
                    lat = float(la); lon = float(lo); break
                except Exception:
                    pass
            if lat is None or lon is None:
                continue

        name = norm_name(s.get("stop_name") or s.get("name") or "")

        if not rids:
            # pas de ligne associée → on ignore (évite des points “bleus”)
            continue

        for rid in sorted(rids):
            r = routes.get(rid, {})
            mode, line = classify_route_and_line(r.get("short",""), r.get("long",""), r.get("type",""))
            if not mode:
                continue  # bus/indéterminé → on saute

            color = parse_color_hex(r.get("color"))
            entry = {"name": name, "mode": mode, "line": line, "lat": lat, "lon": lon}
            if color: entry["colorHex"] = color

            key = (entry["name"], entry["mode"], entry["line"], entry["lat"], entry["lon"])
            if key not in seen:
                seen.add(key)
                out.append(entry)

    return out

# ---------- main ----------

def main() -> int:
    print("Téléchargement GTFS IDFM…")
    url = IDFM_GTFS_URL or discover_latest_zip(DATASET_SLUG)
    if not url:
        print("Impossible de découvrir la dernière archive GTFS IDFM (API data.gouv).")
        return 2
    try:
        gtfs = download_bytes(url)
    except Exception as e:
        print("Téléchargement impossible:", e)
        return 3

    print("Parsing GTFS…")
    try:
        entries = build_entries(gtfs)
    except Exception as e:
        print("Erreur parsing GTFS:", e)
        return 4

    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.abspath(os.path.join(here, "..", "data", "stations.min.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    entries.sort(key=lambda x: (str(x.get("name","")), str(x.get("mode","")), str(x.get("line","")), x.get("lat",0), x.get("lon",0)))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK → {out_path} ({len(entries)} lignes)")
    print("Pense à bumper DATA_VERSION dans js/stations.js et ?bust=… dans l’URL.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
