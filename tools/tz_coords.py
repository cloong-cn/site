"""Writes src/data/tz.json: IANA time zone -> [lat, lon] of the zone's reference city.

The homepage telemetry uses it to estimate where a visitor is from their time zone alone
(no location permission, no IP lookup) and to compute sunrise and sunset there.
Aliases (Asia/Calcutta, Asia/Chongqing, ...) map to the name of their canonical zone.
Run:  python3 tools/tz_coords.py   (reads the system tz database, e.g. /usr/share/zoneinfo)
"""
import json, os, re, zoneinfo

TZDIR = next(p for p in zoneinfo.TZPATH if os.path.exists(os.path.join(p, "zone.tab")))
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "tz.json")


def coord(s):
    m = re.fullmatch(r"([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?", s)
    sa, d1, m1, s1, so, d2, m2, s2 = m.groups()
    lat = (int(d1) + int(m1) / 60 + int(s1 or 0) / 3600) * (1 if sa == "+" else -1)
    lon = (int(d2) + int(m2) / 60 + int(s2 or 0) / 3600) * (1 if so == "+" else -1)
    return [round(lat, 2), round(lon, 2)]


table = {}
for line in open(os.path.join(TZDIR, "zone.tab"), encoding="utf-8"):
    if line.startswith("#") or not line.strip():
        continue
    cols = line.rstrip("\n").split("\t")
    table[cols[2]] = coord(cols[1])

def content(name):
    with open(os.path.join(TZDIR, name), "rb") as f:
        return f.read()

by_bytes = {}
for name in table:
    by_bytes.setdefault(content(name), []).append(name)

for name in sorted(zoneinfo.available_timezones()):
    if name in table or name.startswith(("Etc/", "SystemV/")) or "/" not in name:
        continue
    real = os.path.relpath(os.path.realpath(os.path.join(TZDIR, name)), TZDIR)
    target = real if real in table else None
    if not target:
        same = by_bytes.get(content(name), [])
        prefix = name.split("/")[0]
        target = next((z for z in same if z.startswith(prefix + "/")), same[0] if same else None)
    if target:
        table[name] = target

# Chrome and Safari report some zones by their older CLDR names, which newer tz databases no longer ship
CLDR = {
    "Africa/Asmera": "Africa/Asmara", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "America/Catamarca": "America/Argentina/Catamarca", "America/Cordoba": "America/Argentina/Cordoba",
    "America/Godthab": "America/Nuuk", "America/Indianapolis": "America/Indiana/Indianapolis",
    "America/Jujuy": "America/Argentina/Jujuy", "America/Louisville": "America/Kentucky/Louisville",
    "America/Mendoza": "America/Argentina/Mendoza", "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon", "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Atlantic/Faeroe": "Atlantic/Faroe", "Europe/Kiev": "Europe/Kyiv", "Pacific/Enderbury": "Pacific/Kanton",
    "Pacific/Ponape": "Pacific/Pohnpei", "Pacific/Truk": "Pacific/Chuuk",
}
for old_name, new_name in CLDR.items():
    target = table.get(new_name)
    if old_name not in table and target is not None:
        table[old_name] = new_name if isinstance(target, list) else target

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(table, f, separators=(",", ":"), sort_keys=True)
print(len(table), "zones ->", OUT, os.path.getsize(OUT), "bytes")
