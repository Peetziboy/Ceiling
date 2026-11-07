#!/usr/bin/env python3
"""Holt METAR, TAF (aviationweather.gov, Sammeldateien) und Flugplätze (OurAirports)
für Europa und legt sie als kleine JSON-Dateien neben die App.

Läuft in GitHub Actions. Die App liest die Dateien von ihrer eigenen Adresse,
damit es keine Browser-Sperre (CORS) gibt.

Aufruf: python3 tools/fetch_data.py <ausgabeordner>
"""
import csv
import gzip
import io
import json
import os
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

OUT = os.path.join(sys.argv[1] if len(sys.argv) > 1 else "site", "data")
CACHE = ".cache"
LIVE = "https://peetziboy.github.io/ceiling/data/"  # vorherige Daten, falls ein Abruf scheitert
UA = {"User-Agent": "ceiling-webapp/1.0 (github.com/peetziboy/ceiling)"}
# Europa grob: Breite 34..72, Länge -25..45
BOX = (34.0, 72.0, -25.0, 45.0)

METAR_URL = "https://aviationweather.gov/data/cache/metars.cache.xml.gz"
TAF_URL = "https://aviationweather.gov/data/cache/tafs.cache.xml.gz"
AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"


def get(url, tries=3):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (k + 1))
    raise last


def num(el, tag, conv=float):
    v = el.findtext(tag)
    if v is None or v == "":
        return None
    try:
        return conv(v)
    except ValueError:
        return v  # z. B. "VRB" oder "6+"


def unix(s):
    if not s:
        return None
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def inbox(lat, lon):
    return lat is not None and lon is not None and BOX[0] <= lat <= BOX[1] and BOX[2] <= lon <= BOX[3]


def clouds(el):
    out = []
    for sc in el.findall("sky_condition"):
        cov = sc.get("sky_cover")
        base = sc.get("cloud_base_ft_agl")
        if cov:
            out.append({"cover": cov, "base": int(base) if base not in (None, "") else None})
    vv = el.findtext("vert_vis_ft")
    if vv:
        out.append({"cover": "VV", "base": int(float(vv))})
    return out


def wind(el):
    wd = num(el, "wind_dir_degrees")
    if isinstance(wd, float):
        wd = int(wd)
    return {"wdir": wd, "wspd": num(el, "wind_speed_kt"), "wgst": num(el, "wind_gust_kt")}


def vis(el):
    v = el.findtext("visibility_statute_mi")
    return v if v else None


def parse_metars(raw):
    root = ET.fromstring(gzip.decompress(raw))
    best = {}
    for m in root.iter("METAR"):
        lat, lon = num(m, "latitude"), num(m, "longitude")
        if not inbox(lat, lon):
            continue
        sid = m.findtext("station_id")
        obs = unix(m.findtext("observation_time"))
        if not sid or obs is None or (sid in best and best[sid]["obsTime"] >= obs):
            continue
        alt = num(m, "altim_in_hg")
        best[sid] = {
            "icaoId": sid, "obsTime": obs, "rawOb": m.findtext("raw_text"),
            "lat": lat, "lon": lon, "elev": num(m, "elevation_m"),
            "temp": num(m, "temp_c"), "dewp": num(m, "dewpoint_c"),
            "altim": round(alt * 33.8639) if isinstance(alt, float) else None,
            "visib": vis(m), "clouds": clouds(m), "fltCat": m.findtext("flight_category"),
            **wind(m),
        }
    return list(best.values())


def parse_tafs(raw):
    root = ET.fromstring(gzip.decompress(raw))
    best = {}
    for t in root.iter("TAF"):
        lat, lon = num(t, "latitude"), num(t, "longitude")
        if not inbox(lat, lon):
            continue
        sid = t.findtext("station_id")
        iss = unix(t.findtext("issue_time"))
        if not sid or iss is None or (sid in best and best[sid]["_iss"] >= iss):
            continue
        fc = []
        for f in t.findall("forecast"):
            ch = f.findtext("change_indicator") or None
            fc.append({
                "timeFrom": unix(f.findtext("fcst_time_from")), "timeTo": unix(f.findtext("fcst_time_to")),
                "timeBec": unix(f.findtext("time_becoming")), "fcstChange": ch,
                "probability": num(f, "probability", int), "visib": vis(f),
                "wxString": f.findtext("wx_string") or "", "clouds": clouds(f), **wind(f),
            })
        best[sid] = {
            "_iss": iss, "icaoId": sid, "issueTime": t.findtext("issue_time"),
            "validTimeFrom": unix(t.findtext("valid_time_from")), "validTimeTo": unix(t.findtext("valid_time_to")),
            "rawTAF": t.findtext("raw_text"), "lat": lat, "lon": lon, "fcsts": fc,
        }
    out = list(best.values())
    for x in out:
        x.pop("_iss", None)
    return out


def parse_airports(raw):
    out = {}
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8"))):
        if r.get("continent") != "EU" or r.get("type") not in ("large_airport", "medium_airport", "small_airport"):
            continue
        code = next((c for c in (r.get("icao_code"), r.get("gps_code"), r.get("ident")) if c and len(c) == 4 and c.isalnum()), None)
        if not code:
            continue
        try:
            lat, lon = round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4)
        except (KeyError, ValueError):
            continue
        elev = int(float(r["elevation_ft"])) if r.get("elevation_ft") else None
        out[code.upper()] = [r.get("name", ""), lat, lon, elev]
    return out


def previous(name):
    try:
        return json.loads(get(LIVE + name, tries=1))
    except Exception:  # noqa: BLE001
        return None


def write(name, data):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    status = {"fetchedAt": int(time.time()), "errors": []}

    for name, url, parse in (("metar.json", METAR_URL, parse_metars), ("taf.json", TAF_URL, parse_tafs)):
        try:
            data = parse(get(url))
            if not data:
                raise ValueError("keine Einträge")
            status[name] = len(data)
        except Exception as e:  # noqa: BLE001
            status["errors"].append(f"{name}: {e}")
            data = previous(name) or []
            status[name] = f"alt ({len(data)})"
        write(name, data)

    ap_cache = os.path.join(CACHE, "airports.json")
    try:
        if os.path.exists(ap_cache):
            with open(ap_cache, encoding="utf-8") as f:
                aps = json.load(f)
        else:
            aps = parse_airports(get(AIRPORTS_URL))
            with open(ap_cache, "w", encoding="utf-8") as f:
                json.dump(aps, f)
        status["airports.json"] = len(aps)
    except Exception as e:  # noqa: BLE001
        status["errors"].append(f"airports.json: {e}")
        aps = previous("airports.json") or {}
    write("airports.json", aps)
    write("status.json", status)
    print(json.dumps(status, ensure_ascii=False))


if __name__ == "__main__":
    main()
