#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# build_stations.py — génère data/stations.min.json (Métro/RER/Tram/Transilien)
# - Découverte de l’archive via data.gouv.fr (ou IDFM_GTFS_URL fourni)
# - Parse GTFS routes/stops/trips/stop_times
# - Ne garde PAS les bus
# - Déduit mode + ligne; colorHex = route_color si dispo
# - Sortie: [{name, mode, line, lat, lon, colorHex?}, ...]

import os, re, io, csv, sys, json, zipfile, datetime
from collections import defaultdict
from typing import Dict, Set, Tuple, List, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ─────────────────────────────────────────────────────────────────────────────
# Découverte data.gouv + param utilisateur
# ─────────────────────────────────────────────────────────────────────────────

DATAGOUV_DATASET_SLUG = os.environ.get(
    "DATAGOUV_DATASET_SLUG",
    "reseau-urbain-et-interurbain-dile-de-france-mobilites"
)
IDFM_GTFS_URL = os.environ.get("IDFM_GTFS_URL", "").strip()

def http_get_json(url: str):
    req = Request(url, headers={"User-Agent": "ips-map-builder/1.0"})
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def discover_latest_idfm_zip_url_via_datagouv(slug: str) -> Optional[str]:
    """Trouve la ressource GTFS ZIP la plus récente d’un dataset data.gouv.fr."""
    api = f"https://www.data.gouv.fr/api/1/datasets/{slug}/"
    try:
        data = http_get_json(api)
    except Exception as e:
        print(f"[data.gouv] Échec API dataset: {e}")
        return None

    resources = data.get("resources") or []
    cand: List[Tuple[datetime.datetime, str]] = []
    for res in resources:
        url = (res.get("url") or "").strip()
        fmt = (res.get("format") or "").lower()
        mime = (res.get("mime") or "").lower()
        title = ((res.get("title") or "") + " " + (res.get("description") or "")).lower()

        looks_like_gtfs = (
            "gtfs" in fmt or "gtfs" in mime or "gtfs" in title
            or (url.endswith(".zip") and ("gtfs" in url.lower() or "offre-transport" in url.lower()))
        )
        is_zip = (fmt == "zip" or "zip" in mime or url.endswith(".zip"))
        if url and is_zip and looks_like_gtfs:
            lm = res.get("last_modified") or res.get("created_at") or ""
            try:
                dt = datetime.datetime.fromisoformat(lm.replace("Z", "+00:00"))
            except Exception:
                dt = datetime.datetime.min
            cand.append((dt, url))

    if not cand:
        print("[data.gouv] Aucune ressource GTFS zip trouvée.")
        return None

    cand.sort(reverse=True, key=lambda t: t[0])
    best = cand[0][1]
    print(f"[data.gouv] GTFS sélectionné : {best}")
    return best

def download_bytes(url_or_path: str) -> bytes:
    """Télécharge http(s) OU lit un fichier local (file:// ou ~)."""
    if not url_or_path:
        raise ValueError("URL/chemin vide")
    if url_or_path.startswith("file://"):
        p = os.path.expanduser(url_or_path[7:])
        with open(p, "rb") as f:
            return f.read()
    p = os.path.expanduser(url_or_path)
    if os.path.exists(p):
        with open(p, "rb") as f:
            return f.read()
    req = Request(url_or_path, headers={"User-Agent": "ips-map-builder/1.0"})
    try:
        with urlopen(req, timeout=120) as r:
            return r.read()
    except HTTPError as e:
        raise RuntimeError(f"Téléchargement en échec ({e.code}) : {url_or_path}") from e
    except URLError as e:
        raise RuntimeError(f"Téléchargement en échec : {url_or_path} ({e})") from e

# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires parsing & normalisation
# ─────────────────────────────────────────────────────────────────────────────

METRO_ALLOWED = {str(i) for i in range(1, 15)} | {"3BIS", "7BIS"}  # 1..14 + 3BIS/7BIS
RER_ALLOWED   = set(list("ABCDE"))
TN_ALLOWED    = set(list("HJKLNRPU"))

def parse_color_hex(s: str) -> Optional[str]:
    if not s: return None
    s = str(s).strip()
    m = re.match(r"^#?([0-9A-Fa-f]{6})$", s)
    if m: return f"#{m.group(1).upper()}"
    m = re.match(r"^0x([0-9A-Fa-f]{6})$", s)
    if m: return f"#{m.group(1).upper()}"
    m = re.match(r"^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})", s, re.I)
    if m:
        def to2(x: str) -> str:
            v = max(0, min(255, int(x))); return f"{v:02X}"
        return f"#{to2(m.group(1))}{to2(m.group(2))}{to2(m.group(3))}"
    return None

def norm_name(raw: str) -> str:
    s = (raw or "").strip()
    if not s: return "Gare"
    s = re.sub(r"\bGare(?:\s+SNCF)?\s+(?:de|d’|d'|du|des)\s+", "", s, flags=re.I)
    s = re.sub(r"^Gare\s+", "", s, flags=re.I)
    s = re.sub(r"\s*\((?:RER|SNCF|Transilien|Métro|Metro|Tram|IDFM)[^)]+\)\s*", " ", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*RER\s+[A-E]\b", "", s, flags=re.I)
    s = re.sub(r"\s*[-–]\s*Ligne\s+[A-Z0-9]+$", "", s, flags=re.I)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s or "Gare"

def normalize_line_from_short(mode: str, short_name: str) -> Optional[str]:
    s = (short_name or "").upper().strip()
    if not s: return None
    if mode == "metro":
        m = re.match(r"^(?:M)?\s*0*([0-9]{1,2})$", s)
        if m and m.group(1) in METRO_ALLOWED: return m.group(1)
        m = re.match(r"^(?:M)?\s*(3|7)\s*BIS$", s)
        if m: return "3BIS" if m.group(1) == "3" else "7BIS"
        return None
    if mode == "tram":
        m = re.match(r"^(?:T)?\s*([0-9]{1,2}[AB]?)$", s)
        if m: return f"T{m.group(1)}"
        return None
    if mode == "rer":
        m = re.match(r"^[A-E]$", s)
        if m: return m.group(0)
        return None
    if mode == "transilien":
        m = re.match(r"^[HJKLNRPU]$", s)
        if m: return m.group(0)
        return None
    return None

def normalize_line(raw: str, mode: str) -> Optional[str]:
    if not raw: return None
    S = str(raw).upper()
    if mode == "rer":
        m = re.search(r"\bRER\s*([A-E])\b", S)
        if m: return m.group(1)
    if mode == "metro":
        m = re.search(r"\b(?:M|MÉTRO|METRO|LIGNE)\s*(3BIS|7BIS)\b", S)
        if m: return m.group(1)
        m = re.search(r"\b(?:M|MÉTRO|METRO|LIGNE)\s*([0-9]{1,2})\b", S)
        if m and m.group(1) in METRO_ALLOWED: return m.group(1)
    if mode == "tram":
        m = re.search(r"\bT\s*([0-9]{1,2}[AB]?)\b", S)
        if m: return f"T{m.group(1)}"
        m = re.search(r"\bTRAM\s*([0-9]{1,2}[AB]?)\b", S)
        if m: return f"T{m.group(1)}"
    if mode == "transilien":
        m = re.search(r"\b([HJKLNRPU])\b", S)
        if m: return m.group(1)
    return None

def greedy_line(mode: str, short_name: str, long_name: str) -> Optional[str]:
    """Dernier recours — mais on reste strict (éviter de prendre des bus)."""
    s = (short_name or "").upper()
    l = (long_name  or "").upper()
    both = f"{s} {l}".strip()

    if mode == "rer":
        m = re.search(r"\bRER\s*([A-E])\b", both) or re.search(r"\b([A-E])\b", both)
        return m.group(1) if m else None

    if mode == "metro":
        m = re.search(r"\b(3BIS|7BIS)\b", both)
        if m: return m.group(1)
        m = re.search(r"\b([0-9]{1,2})\b", both)
        if m and m.group(1) in METRO_ALLOWED: return m.group(1)
        return None

    if mode == "tram":
        m = re.search(r"\bT\s*([0-9]{1,2}[AB]?)\b", both) or re.search(r"\b([0-9]{1,2}[AB]?)\b", both)
        return f"T{m.group(1)}" if m else None

    if mode == "transilien":
        m = re.search(r"\b([HJKLNRPU])\b", both)
        return m.group(1) if m else None

    return None

def deduce_mode_from_route(route_type: str, short_name: str, long_name: str = "") -> Optional[str]:
    """Déduit le mode en combinant route_type et motifs — en excluant BUS."""
    rt = str(route_type or "").strip()  # GTFS: 0=Tram, 1=Subway, 2=Rail, 3=Bus, ...
    s  = (short_name or "").upper().strip()
    l  = (long_name  or "").upper().strip()

    # Exclusion BUS immédiate
    if rt == "3":
        return None

    # Métro: route_type 1 OU présence claire de METRO/MÉTRO + index 1..14/3BIS/7BIS
    if rt == "1" or "MÉTRO" in l or "METRO" in l:
        # on accepte métro seulement si numéro cohérent
        if s in METRO_ALLOWED or re.fullmatch(r"(?:M|METRO|MÉTRO)?\s*(3BIS|7BIS)", s) or re.fullmatch(r"(?:M|METRO|MÉTRO)?\s*([0-9]{1,2})", s):
            num = normalize_line_from_short("metro", s) or normalize_line(l, "metro") or greedy_line("metro", s, l)
            if num in METRO_ALLOWED:
                return "metro"

    # Tram: route_type 0 OU présence d'un Tn
    if rt == "0" or "TRAM" in l or re.search(r"\bT\s*\d", s):
        ln = normalize_line_from_short("tram", s) or normalize_line(l, "tram") or greedy_line("tram", s, l)
        if ln:
            return "tram"

    # Rail (RER/Transilien) → route_type 2 recommandé
    if rt == "2" or "RER" in l or "TRANSILIEN" in l:
        # RER si on a lettre A-E ET mention RER quelque part
        if ("RER" in l or "RER" in s):
            rr = normalize_line_from_short("rer", s) or normalize_line(l, "rer") or greedy_line("rer", s, l)
            if rr in RER_ALLOWED:
                return "rer"
        # Transilien si lettre HJKLNRPU
        tn = normalize_line_from_short("transilien", s) or normalize_line(l, "transilien") or greedy_line("transilien", s, l)
        if tn in TN_ALLOWED:
            return "transilien"

    # TER/TGV (rare dans IDFM)
    if "TER" in l or s == "TER":
        return "ter"
    if "TGV" in l or s == "TGV":
        return "tgv"

    return None

# ─────────────────────────────────────────────────────────────────────────────
# Lecture GTFS
# ─────────────────────────────────────────────────────────────────────────────

def read_csv_from_zip(zf: zipfile.ZipFile, names: List[str]) -> Optional[List[Dict[str, str]]]:
    namemap = {n.lower(): n for n in zf.namelist()}
    for cand in names:
        if cand.lower() in namemap:
            with zf.open(namemap[cand.lower()], "r") as f:
                data = f.read().decode("utf-8", errors="replace")
            return [row for row in csv.DictReader(io.StringIO(data))]
    return None

def build_station_entries_from_gtfs(gtfs_bytes: bytes) -> List[Dict[str, object]]:
    zf = zipfile.ZipFile(io.BytesIO(gtfs_bytes), "r")

    # routes
    routes_rows = read_csv_from_zip(zf, ["routes.txt"]) or []
    routes: Dict[str, Dict[str, str]] = {}
    for r in routes_rows:
        rid = (r.get("route_id") or "").strip()
        if not rid: continue
        routes[rid] = {
            "short": (r.get("route_short_name") or "").strip(),
            "long":  (r.get("route_long_name")  or "").strip(),
            "type":  (r.get("route_type")       or "").strip(),
            "color": (r.get("route_color")      or "").strip(),
        }

    # stops
    stops_rows = read_csv_from_zip(zf, ["stops.txt"]) or []
    stops: Dict[str, Dict[str, str]] = {}
    parent_of: Dict[str, str] = {}
    children_of: Dict[str, List[str]] = defaultdict(list)
    station_ids: Set[str] = set()
    for s in stops_rows:
        sid = (s.get("stop_id") or "").strip()
        if not sid: continue
        stops[sid] = s
    for sid, s in stops.items():
        loc_type = (s.get("location_type") or "").strip()
        parent = (s.get("parent_station") or "").strip()
        if parent:
            parent_of[sid] = parent
            children_of[parent].append(sid)
        if loc_type == "1":
            station_ids.add(sid)

    # trips
    trips_rows = read_csv_from_zip(zf, ["trips.txt"]) or []
    trip_to_route: Dict[str, str] = {}
    for t in trips_rows:
        tid = (t.get("trip_id") or "").strip()
        rid = (t.get("route_id") or "").strip()
        if tid and rid:
            trip_to_route[tid] = rid

    # stop_times
    stop_to_routes: Dict[str, Set[str]] = defaultdict(set)
    st_rows = read_csv_from_zip(zf, ["stop_times.txt"]) or []
    for st in st_rows:
        sid = (st.get("stop_id") or "").strip()
        tid = (st.get("trip_id") or "").strip()
        if not sid or not tid: continue
        rid = trip_to_route.get(tid)
        if rid: stop_to_routes[sid].add(rid)

    # routes au niveau station (parent)
    station_routes: Dict[str, Set[str]] = defaultdict(set)
    for sid in stops.keys():
        dest = None
        if sid in parent_of:
            p = parent_of[sid]
            if (stops.get(p, {}).get("location_type") or "") == "1":
                dest = p
        elif sid in station_ids:
            dest = sid
        if not dest: dest = sid
        if sid in stop_to_routes:
            station_routes[dest].update(stop_to_routes[sid])
    for stid in station_ids:
        station_routes.setdefault(stid, set())

    out: List[Dict[str, object]] = []
    seen: Set[Tuple[str, str, Optional[str], float, float]] = set()

    for stid, route_ids in station_routes.items():
        s = stops.get(stid, {})
        # coords (station ou 1er enfant)
        lat = s.get("stop_lat") or s.get("stop_lat_wgs84") or s.get("lat") or ""
        lon = s.get("stop_lon") or s.get("stop_lon_wgs84") or s.get("lon") or ""
        try:
            lat = float(lat); lon = float(lon)
        except Exception:
            lat = lon = None
            for child in children_of.get(stid, []):
                sc = stops.get(child, {})
                try:
                    lat = float(sc.get("stop_lat") or "")
                    lon = float(sc.get("stop_lon") or "")
                    break
                except Exception:
                    continue
            if lat is None or lon is None:
                continue

        name = norm_name(s.get("stop_name") or s.get("stop_desc") or s.get("name") or "")

        # Pas de routes reliées → ignore
        if not route_ids:
            continue

        for rid in sorted(route_ids):
            r = routes.get(rid, {})
            rt, short, long, color = r.get("type"), r.get("short"), r.get("long"), r.get("color")

            mode = deduce_mode_from_route(rt, short, long)
            if mode is None:
                continue  # ignore bus et indéterminés

            # ligne (strict)
            line = (
                normalize_line_from_short(mode, short) or
                normalize_line(long, mode)            or
                greedy_line(mode, short, long)
            )

            # dernier garde-fou: invalide les lignes incohérentes
            if mode == "metro" and line not in METRO_ALLOWED:    continue
            if mode == "rer"   and line not in RER_ALLOWED:      continue
            if mode == "transilien" and line not in TN_ALLOWED:  continue
            if mode == "tram"  and (not line or not line.upper().startswith("T")): continue

            entry = {"name": name, "mode": mode, "line": line, "lat": lat, "lon": lon}
            col = parse_color_hex(color or "")
            if col: entry["colorHex"] = col

            key = (entry["name"], entry["mode"], entry["line"], entry["lat"], entry["lon"])
            if key not in seen:
                seen.add(key)
                out.append(entry)

    return out

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    print("Téléchargement GTFS IDFM…")
    url = IDFM_GTFS_URL or discover_latest_idfm_zip_url_via_datagouv(DATAGOUV_DATASET_SLUG)
    if not url:
        print("Impossible de découvrir la dernière archive GTFS IDFM (API data.gouv).")
        return 2
    try:
        gtfs_bytes = download_bytes(url)
    except Exception as e:
        print(f"Téléchargement impossible: {e}")
        return 3

    print("Parsing GTFS…")
    try:
        entries = build_station_entries_from_gtfs(gtfs_bytes)
    except Exception as e:
        print("Erreur pendant le parsing GTFS:", e)
        return 4

    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.abspath(os.path.join(here, "..", "data", "stations.min.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    entries.sort(key=lambda x: (
        str(x.get("name") or ""),
        str(x.get("mode") or ""),
        str(x.get("line") or ""),
        x.get("lat") or 0.0, x.get("lon") or 0.0
    ))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK → {out_path} ({len(entries)} enregistrements)")
    print("Astuce: aligne DATA_VERSION dans js/stations.js et recharge avec ?bust=…")
    return 0

if __name__ == "__main__":
    sys.exit(main())
