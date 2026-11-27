#!/usr/bin/env python3
"""
枚方市地図クイズ（/data/map-quiz/）のデータを作るスクリプト。

入力：
  1. e-Stat 2020年国勢調査 小地域境界データ（大阪府枚方市 27210、JGD2011、Shapefile ZIP）
  2. e-Stat 2020年国勢調査 小地域集計 年齢（5歳階級、4区分）別・男女別人口（tblT001082、CSV ZIP）
  3. サイト内のデータ：
     - public/opendata/{park,hinanjo,kosodate,aed,toilet,shisetsu}.json（枚方市オープンデータ CC BY 2.1 JP）
     - public/maps/chikei/heights.png・content/data/chikei.json（国土地理院 標高タイル）
     - content/data/gallery/*.json（位置情報つき写真ギャラリー）

使い方：
  python3 scripts/map-quiz-data.py --shape /path/to/r2ka27210.zip --age /path/to/tblT001082C27210.zip
  （引数を省くと e-Stat から自動で取得する）

出力：
  - public/maps/quiz-districts.json（ブラウザが読む地図ポリゴンと地区別統計）
  - content/data/map-quiz-meta.json（ビルド時にページの見出し・件数・出典に使う要約）
"""

from __future__ import annotations

import argparse
import csv
import glob
import io
import json
import math
import re
import struct
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
ESTAT_SHAPE_URL = (
    "https://www.e-stat.go.jp/gis/statmap-search/data"
    "?dlserveyId=A002005212020&code=27210&coordSys=1&format=shape&downloadType=5&datum=2011"
)
ESTAT_AGE_URL = (
    "https://www.e-stat.go.jp/gis/statmap-search/data"
    "?statsId=T001082&code=27210&downloadType=2"
)

# 入門（かんたん）モードに出す、枚方で知名度の高い主要地区（約 32 地区）
EASY_NAMES = {
    "宮之阪",
    "枚方公園町",
    "岡東町",
    "新町",
    "大垣内町",
    "三矢町",
    "伊加賀西町",
    "香里ケ丘",
    "東香里",
    "北中振",
    "出口",
    "星丘",
    "村野本町",
    "山之上",
    "中宮本町",
    "禁野本町",
    "御殿山町",
    "牧野阪",
    "楠葉花園町",
    "南楠葉",
    "町楠葉",
    "船橋本町",
    "招提中町",
    "山田池公園",
    "田口山",
    "長尾元町",
    "北山",
    "藤阪中町",
    "津田駅前",
    "王仁公園",
    "車塚",
    "穂谷",
    "尊延寺",
    "氷室台",
    "茄子作",
}

# 地区と公開済み記事の対応（記事のある地区では正解後に関連記事へ案内する）
DISTRICT_ARTICLES: dict[str, list[str]] = {
    "香里ケ丘": ["jinko"],
    "楠葉花園町": ["kuzuha-mall"],
    "南楠葉": ["kuzuha-mall"],
    "町楠葉": ["kuzuha-mall"],
    "岡東町": ["tsutaya"],
    "岡本町": ["viorne"],
    "新町": ["kmu-tower"],
    "田口山": ["pomunoki"],
    "車塚": ["toshokan"],
    "北山": ["kokkai"],
    "星丘": ["atsui"],
}

# 枚方市内の主な鉄道駅（緯度・経度、路線名）
STATIONS = [
    {"name": "光善寺", "line": "京阪本線", "lat": 34.7946, "lon": 135.6300},
    {"name": "枚方公園", "line": "京阪本線", "lat": 34.8087, "lon": 135.6388},
    {"name": "枚方市", "line": "京阪本線・交野線", "lat": 34.8165, "lon": 135.6497},
    {"name": "御殿山", "line": "京阪本線", "lat": 34.8300, "lon": 135.6540},
    {"name": "牧野", "line": "京阪本線", "lat": 34.8479, "lon": 135.6615},
    {"name": "樟葉", "line": "京阪本線", "lat": 34.8634, "lon": 135.6754},
    {"name": "宮之阪", "line": "京阪交野線", "lat": 34.8147, "lon": 135.6606},
    {"name": "星ヶ丘", "line": "京阪交野線", "lat": 34.8089, "lon": 135.6647},
    {"name": "村野", "line": "京阪交野線", "lat": 34.7999, "lon": 135.6660},
    {"name": "津田", "line": "JR学研都市線", "lat": 34.8013, "lon": 135.6979},
    {"name": "藤阪", "line": "JR学研都市線", "lat": 34.8169, "lon": 135.7082},
    {"name": "長尾", "line": "JR学研都市線", "lat": 34.8315, "lon": 135.7147},
]

# 補助表示用の鉄道路線（ヒントの「線路・川を表示」で重ねる簡略線）
RAIL_LINES = [
    {
        "name": "京阪本線",
        "pts": [
            (34.7820, 135.6265),
            (34.7946, 135.6300),
            (34.8087, 135.6388),
            (34.8165, 135.6497),
            (34.8300, 135.6540),
            (34.8479, 135.6615),
            (34.8634, 135.6754),
            (34.8760, 135.6895),
        ],
    },
    {
        "name": "京阪交野線",
        "pts": [
            (34.8165, 135.6497),
            (34.8147, 135.6606),
            (34.8089, 135.6647),
            (34.7999, 135.6660),
            (34.7915, 135.6705),
        ],
    },
    {
        "name": "JR学研都市線",
        "pts": [
            (34.7945, 135.6935),
            (34.8013, 135.6979),
            (34.8169, 135.7082),
            (34.8315, 135.7147),
            (34.8400, 135.7240),
        ],
    },
]

# 補助表示用の主な川（ヒント用簡略線）
RIVER_LINES = [
    {
        "name": "淀川",
        "pts": [
            (34.7860, 135.6050),
            (34.7980, 135.6190),
            (34.8105, 135.6310),
            (34.8200, 135.6410),
            (34.8345, 135.6475),
            (34.8505, 135.6545),
            (34.8675, 135.6675),
            (34.8810, 135.6820),
        ],
    },
    {
        "name": "天野川",
        "pts": [
            (34.7875, 135.6750),
            (34.7990, 135.6700),
            (34.8080, 135.6635),
            (34.8150, 135.6565),
            (34.8200, 135.6495),
            (34.8225, 135.6435),
        ],
    },
    {
        "name": "穂谷川",
        "pts": [
            (34.8120, 135.7470),
            (34.8225, 135.7160),
            (34.8260, 135.6910),
            (34.8310, 135.6745),
            (34.8405, 135.6550),
        ],
    },
    {
        "name": "船橋川",
        "pts": [
            (34.8390, 135.7110),
            (34.8485, 135.6940),
            (34.8535, 135.6780),
            (34.8580, 135.6630),
        ],
    },
]


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "hirakatapedia-map-quiz/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def read_estat_shapefile(raw_zip: bytes):
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as z:
        dbf_name = next(n for n in z.namelist() if n.endswith(".dbf"))
        shp_name = next(n for n in z.namelist() if n.endswith(".shp"))
        dbf_raw = z.read(dbf_name)
        shp_raw = z.read(shp_name)

    num_rec, header_len, rec_len = struct.unpack("<IHH", dbf_raw[4:12])
    fields = []
    pos = 32
    while dbf_raw[pos] != 0x0D:
        fields.append(
            (dbf_raw[pos : pos + 11].split(b"\x00")[0].decode("ascii"), chr(dbf_raw[pos + 11]), dbf_raw[pos + 16])
        )
        pos += 32

    recs = []
    for i in range(num_rec):
        off = header_len + i * rec_len + 1
        row = {}
        for name, _ftype, flen in fields:
            row[name] = dbf_raw[off : off + flen].decode("cp932", errors="replace").strip()
            off += flen
        recs.append(row)

    def signed_area(ring: list[tuple[float, float]]) -> float:
        return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2

    geoms = []
    pos = 100
    while pos < len(shp_raw):
        _rec_num, content_len = struct.unpack(">II", shp_raw[pos : pos + 8])
        pos += 8
        end = pos + content_len * 2
        shape_type = struct.unpack("<I", shp_raw[pos : pos + 4])[0]
        if shape_type == 5:
            num_parts, num_pts = struct.unpack("<II", shp_raw[pos + 36 : pos + 44])
            parts = list(struct.unpack(f"<{num_parts}I", shp_raw[pos + 44 : pos + 44 + 4 * num_parts]))
            pts_off = pos + 44 + 4 * num_parts
            pts = [struct.unpack("<dd", shp_raw[pts_off + i * 16 : pts_off + (i + 1) * 16]) for i in range(num_pts)]
            rings = []
            for p_idx in range(num_parts):
                s = parts[p_idx]
                e = parts[p_idx + 1] if p_idx + 1 < num_parts else num_pts
                rings.append(pts[s:e])
            exteriors = [r for r in rings if signed_area(r) < 0]
            holes = [r for r in rings if signed_area(r) >= 0]
            polys = []
            for ext in exteriors:
                p = Polygon(ext)
                if not p.is_valid:
                    p = p.buffer(0)
                my_holes = [h for h in holes if p.contains(Point(h[0]))]
                if my_holes:
                    p = Polygon(ext, my_holes)
                    if not p.is_valid:
                        p = p.buffer(0)
                polys.append(p)
            geoms.append(unary_union(polys) if len(polys) > 1 else (polys[0] if polys else Polygon()))
        else:
            geoms.append(Polygon())
        pos = end
    return recs, geoms


def parse_int(val: str) -> int:
    val = val.strip()
    if not val or val in ("-", "X", "x", "*"):
        return 0
    return int(val)


def read_estat_age(raw_zip: bytes):
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as z:
        name = z.namelist()[0]
        text = z.read(name).decode("cp932")
    rows = list(csv.reader(io.StringIO(text)))
    by_code = {}
    city_row = None
    for r in rows[2:]:
        if not r:
            continue
        code = r[0].strip()
        if code == "27210":
            city_row = r
        by_code[code] = r
    return city_row, by_code


def load_elevation_grid():
    meta = json.loads((ROOT / "content/data/chikei.json").read_text("utf-8"))
    img = Image.open(ROOT / "public/maps/chikei/heights.png").convert("RGB")
    arr = np.asarray(img, dtype=np.float32)
    h_grid = (arr[:, :, 0] * 256.0 + arr[:, :, 1]) / 50.0 - 100.0
    nw_lat, nw_lon = meta["nw"]
    se_lat, se_lon = meta["se"]

    def my(lat: float) -> float:
        return math.asinh(math.tan(math.radians(lat)))

    my_nw, my_se = my(nw_lat), my(se_lat)
    n = h_grid.shape[0]

    def sample_poly(geom):
        minx, miny, maxx, maxy = geom.bounds
        u0 = max(0, int(((minx - nw_lon) / (se_lon - nw_lon)) * n))
        u1 = min(n - 1, int(((maxx - nw_lon) / (se_lon - nw_lon)) * n) + 1)
        v0 = max(0, int(((my(maxy) - my_nw) / (my_se - my_nw)) * n))
        v1 = min(n - 1, int(((my(miny) - my_nw) / (my_se - my_nw)) * n) + 1)
        vals = []
        step = max(1, (u1 - u0) // 25)
        for iy in range(v0, v1 + 1, step):
            v = (iy + 0.5) / n
            lat = math.degrees(math.atan(math.sinh(my_nw + (my_se - my_nw) * v)))
            for ix in range(u0, u1 + 1, step):
                u = (ix + 0.5) / n
                lon = nw_lon + (se_lon - nw_lon) * u
                if geom.contains(Point(lon, lat)):
                    vals.append(float(h_grid[iy, ix]))
        if not vals:
            rp = geom.representative_point()
            u = (rp.x - nw_lon) / (se_lon - nw_lon)
            v = (my(rp.y) - my_nw) / (my_se - my_nw)
            ix = min(n - 1, max(0, int(u * n)))
            iy = min(n - 1, max(0, int(v * n)))
            vals = [float(h_grid[iy, ix])]
        return [round(min(vals)), round(sum(vals) / len(vals)), round(max(vals))]

    return sample_poly


def load_opendata_points(dataset_id: str):
    p = ROOT / f"public/opendata/{dataset_id}.json"
    d = json.loads(p.read_text("utf-8"))
    cols = {c[0]: i for i, c in enumerate(d["columns"])}
    la = next((i for i, c in enumerate(d["columns"]) if c[1] == "lat"), -1)
    lo = next((i for i, c in enumerate(d["columns"]) if c[1] == "lon"), -1)
    return d["rows"], cols, la, lo


def load_gallery_photos():
    out = []
    for f in sorted(glob.glob(str(ROOT / "content/data/gallery/*.json"))):
        d = json.loads(Path(f).read_text("utf-8"))
        for p in d.get("photos", []):
            if p.get("lat") is not None and p.get("lon") is not None:
                out.append(p)
    out.sort(key=lambda p: (-(p.get("year") or -1), p.get("id", "")))
    return out


def load_article_titles():
    titles = {}
    for p in (ROOT / "content/articles").glob("*.md"):
        txt = p.read_text("utf-8")
        m_draft = re.search(r"^draft:\s*true\s*$", txt, re.M)
        if m_draft:
            continue
        m_title = re.search(r'^title:\s*"?(.*?)"?\s*$', txt, re.M)
        if m_title:
            titles[p.stem] = m_title.group(1)
    return titles


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = math.radians
    dlat = r(lat2 - lat1)
    dlon = r(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shape", help="e-Stat 小地域境界 Shapefile ZIP のパス")
    ap.add_argument("--age", help="e-Stat 小地域年齢別人口 CSV ZIP のパス")
    args = ap.parse_args()

    shape_bytes = Path(args.shape).read_bytes() if args.shape else fetch_bytes(ESTAT_SHAPE_URL)
    age_bytes = Path(args.age).read_bytes() if args.age else fetch_bytes(ESTAT_AGE_URL)

    recs, geoms = read_estat_shapefile(shape_bytes)
    city_row, age_by_code = read_estat_age(age_bytes)
    assert city_row is not None, "枚方市（27210）の集計行が見つかりません"

    # 町名単位にまとめる（丁目や飛び地の複数レコードを 1 地区に結合）
    # e-Stat の一部表記揺れは枚方市公式の住居表示台帳・日本郵便に合わせる
    name_normalize = {"長尾荒坂": "長尾荒阪"}
    by_name: dict[str, list[tuple[dict, object, str]]] = defaultdict(list)
    for r, g in zip(recs, geoms):
        k9 = r["KEY_CODE"][:9]
        age_r = age_by_code.get(k9)
        name = age_r[3].strip() if age_r else re.sub(r"[一二三四五六七八九十]+丁目$", "", r["S_NAME"])
        name = name_normalize.get(name, name)
        by_name[name].append((r, g, k9))

    # 全体の境界から SVG 座標系（幅 1000）を決める
    all_union = unary_union(geoms)
    minx, miny, maxx, maxy = all_union.bounds
    mid_lat = (miny + maxy) / 2.0
    cos_lat = math.cos(math.radians(mid_lat))
    pad = 24.0
    w_svg = 1000.0
    geo_w = (maxx - minx) * cos_lat
    geo_h = maxy - miny
    scale = (w_svg - pad * 2) / geo_w
    h_svg = round(geo_h * scale + pad * 2, 1)

    def proj(lon: float, lat: float) -> tuple[float, float]:
        x = pad + (lon - minx) * cos_lat * scale
        y = pad + (maxy - lat) * scale
        return round(x, 1), round(y, 1)

    def geom_to_svg_path(geom) -> str:
        polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        segs = []
        for poly in polys:
            if poly.is_empty:
                continue
            for ring in [poly.exterior, *poly.interiors]:
                coords = [proj(x, y) for x, y in ring.coords]
                if len(coords) < 3:
                    continue
                parts = [f"M{coords[0][0]},{coords[0][1]}"]
                for x, y in coords[1:-1]:
                    parts.append(f"L{x},{y}")
                parts.append("Z")
                segs.append("".join(parts))
        return "".join(segs)

    # 既存データの読み込み
    sample_elev = load_elevation_grid()
    parks_rows, parks_cols, parks_la, parks_lo = load_opendata_points("park")
    hinanjo_rows, _, hinanjo_la, hinanjo_lo = load_opendata_points("hinanjo")
    kosodate_rows, _, kosodate_la, kosodate_lo = load_opendata_points("kosodate")
    aed_rows, _, aed_la, aed_lo = load_opendata_points("aed")
    toilet_rows, _, toilet_la, toilet_lo = load_opendata_points("toilet")
    shisetsu_rows, shisetsu_cols, _, _ = load_opendata_points("shisetsu")
    gallery_photos = load_gallery_photos()
    article_titles = load_article_titles()

    park_pts = [
        (Point(float(r[parks_lo]), float(r[parks_la])), int(r[parks_cols["桜の本数"]] or 0))
        for r in parks_rows
        if r[parks_la] and r[parks_lo]
    ]
    hinanjo_pts = [Point(float(r[hinanjo_lo]), float(r[hinanjo_la])) for r in hinanjo_rows if r[hinanjo_la] and r[hinanjo_lo]]
    kosodate_pts = [Point(float(r[kosodate_lo]), float(r[kosodate_la])) for r in kosodate_rows if r[kosodate_la] and r[kosodate_lo]]
    aed_pts = [Point(float(r[aed_lo]), float(r[aed_la])) for r in aed_rows if r[aed_la] and r[aed_lo]]
    toilet_pts = [Point(float(r[toilet_lo]), float(r[toilet_la])) for r in toilet_rows if r[toilet_la] and r[toilet_lo]]
    shisetsu_addrs = [str(r[shisetsu_cols["住所"]] or "") for r in shisetsu_rows]

    # 地区リストを構築
    yomi_path = ROOT / "content/data/map-quiz-yomi.json"
    yomi_map = json.loads(yomi_path.read_text("utf-8")) if yomi_path.exists() else {}
    districts = []
    geom_list = []
    for idx, (name, items) in enumerate(sorted(by_name.items(), key=lambda kv: kv[1][0][2])):
        raw_geom = unary_union([g for _, g, _ in items])
        simp_geom = raw_geom.simplify(0.00010, preserve_topology=True)
        # 人口・世帯・面積・年齢集計
        pop = sum(int(r["JINKO"] or 0) for r, _, _ in items)
        hh = sum(int(r["SETAI"] or 0) for r, _, _ in items)
        area_m2 = sum(float(r["AREA"] or 0.0) for r, _, _ in items)
        area_km2 = round(area_m2 / 1_000_000.0, 3)

        # ユニークな k9 ごとに年齢別集計を合算（楠葉中之芝など複数 k9 対応）
        seen_k9 = sorted({k9 for _, _, k9 in items})
        u15 = sum(parse_int(age_by_code[k][23]) for k in seen_k9 if k in age_by_code)
        w15_64 = sum(parse_int(age_by_code[k][24]) for k in seen_k9 if k in age_by_code)
        o65 = sum(parse_int(age_by_code[k][25]) for k in seen_k9 if k in age_by_code)
        known_age = u15 + w15_64 + o65
        u15_pct = round(u15 / known_age * 100, 1) if known_age >= 30 else None
        o65_pct = round(o65 / known_age * 100, 1) if known_age >= 30 else None

        # 代表点（最大ポリゴンの内部点）
        main_poly = max(raw_geom.geoms, key=lambda p: p.area) if raw_geom.geom_type == "MultiPolygon" else raw_geom
        rp = main_poly.representative_point()
        cx, cy = proj(rp.x, rp.y)

        # 標高
        elev = sample_elev(raw_geom)

        # 施設集計
        p_in = [sakura for pt, sakura in park_pts if raw_geom.contains(pt)]
        parks_n = len(p_in)
        sakura_n = sum(p_in)
        hinanjo_n = sum(1 for pt in hinanjo_pts if raw_geom.contains(pt))
        kosodate_n = sum(1 for pt in kosodate_pts if raw_geom.contains(pt))
        aed_n = sum(1 for pt in aed_pts if raw_geom.contains(pt))
        toilet_n = sum(1 for pt in toilet_pts if raw_geom.contains(pt))
        # 公共施設は住所文字列から前方一致（長い町名に誤爆しないよう数字・丁目・末尾で区切る）
        pat = re.compile(rf"^(?:大阪府)?(?:枚方市)?{re.escape(name)}(?:[0-9０-９一二三四五六七八九十\-−丁目]|$)")
        shisetsu_n = sum(1 for a in shisetsu_addrs if pat.search(a))

        # 写真ギャラリー（ポリゴン内の位置情報つき写真から最大 2 枚。ヒント表示時のクレジット表記用に撮影者・ライセンスも保持）
        photos_in = []
        for p in gallery_photos:
            if raw_geom.contains(Point(p["lon"], p["lat"])):
                author_name = (p.get("author") or {}).get("name", "") if isinstance(p.get("author"), dict) else ""
                photos_in.append([p["id"], p.get("year"), author_name, p.get("license", "")])
                if len(photos_in) >= 2:
                    break

        # 最寄り駅
        nearest_st = min(STATIONS, key=lambda s: haversine_km(rp.y, rp.x, s["lat"], s["lon"]))
        st_dist = round(haversine_km(rp.y, rp.x, nearest_st["lat"], nearest_st["lon"]), 1)

        # 関連記事
        arts = [
            {"slug": s, "title": article_titles[s]}
            for s in DISTRICT_ARTICLES.get(name, [])
            if s in article_titles
        ]

        chome_n = len({r["S_NAME"] for r, _, _ in items})
        dens = round(pop / area_km2) if area_km2 > 0 else 0

        districts.append(
            {
                "id": f"d{idx:03d}",
                "name": name,
                "yomi": str(yomi_map.get(name, "")).strip(),
                "chome": chome_n,
                "d": geom_to_svg_path(simp_geom),
                "cx": cx,
                "cy": cy,
                "lat": round(rp.y, 5),
                "lon": round(rp.x, 5),
                "pop": pop,
                "hh": hh,
                "area": area_km2,
                "dens": dens,
                "u15": u15_pct,
                "o65": o65_pct,
                "elev": elev,
                "parks": parks_n,
                "sakura": sakura_n,
                "hinanjo": hinanjo_n,
                "kosodate": kosodate_n,
                "aed": aed_n,
                "toilet": toilet_n,
                "shisetsu": shisetsu_n,
                "st": [nearest_st["name"], nearest_st["line"], st_dist],
                "photos": photos_in,
                "articles": arts,
                "neighbors": [],
            }
        )
        geom_list.append(raw_geom)

    # 順位（人口・面積・密度）と難易度ティアを付ける
    for key, rank_key in [("pop", "popRank"), ("area", "areaRank")]:
        order = sorted(range(len(districts)), key=lambda i: -districts[i][key])
        for r_idx, i in enumerate(order, 1):
            districts[i][rank_key] = r_idx

    for dist in districts:
        if dist["name"] in EASY_NAMES:
            dist["tier"] = 1
        elif not dist["name"].startswith("大字") and (dist["popRank"] <= 95 or dist["areaRank"] <= 85):
            dist["tier"] = 2
        else:
            dist["tier"] = 3

    # 隣接地区を判定（わずかにバッファして境界の微差を吸収）
    buffered = [g.buffer(0.00018) for g in geom_list]
    for i in range(len(districts)):
        nbrs = []
        for j in range(len(districts)):
            if i != j and buffered[i].intersects(geom_list[j]):
                nbrs.append(districts[j]["name"])
        districts[i]["neighbors"] = nbrs

    # 市の全体統計
    city_pop = parse_int(city_row[7])
    city_u15 = parse_int(city_row[23])
    city_w = parse_int(city_row[24])
    city_o65 = parse_int(city_row[25])
    city_known = city_u15 + city_w + city_o65
    city_area = round(sum(d["area"] for d in districts), 2)

    # 補助レイヤー（川・線路・駅）を SVG 座標へ変換
    def to_polyline(pts):
        return " ".join(f"{proj(lon, lat)[0]},{proj(lon, lat)[1]}" for lat, lon in pts)

    out = {
        "viewBox": [0, 0, w_svg, h_svg],
        "city": {
            "pop": city_pop,
            "area": city_area,
            "u15": round(city_u15 / city_known * 100, 1),
            "o65": round(city_o65 / city_known * 100, 1),
            "count": len(districts),
        },
        "rivers": [{"name": r["name"], "pts": to_polyline(r["pts"])} for r in RIVER_LINES],
        "rails": [{"name": r["name"], "pts": to_polyline(r["pts"])} for r in RAIL_LINES],
        "stations": [
            {"name": s["name"], "line": s["line"], "x": proj(s["lon"], s["lat"])[0], "y": proj(s["lon"], s["lat"])[1]}
            for s in STATIONS
        ],
        "districts": districts,
    }

    # 読み仮名（yomi）の欠落・空文字があれば書き出さずに終了する
    missing_yomi = [d["name"] for d in districts if not d["yomi"]]
    if missing_yomi:
        print(
            f"ERROR: 読み仮名（content/data/map-quiz-yomi.json）が未設定の地区があります（{len(missing_yomi)}件）: {', '.join(missing_yomi)}",
            file=sys.stderr,
        )
        sys.exit(1)

    out_path = ROOT / "public/maps/quiz-districts.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")

    meta = {
        "count": len(districts),
        "quizCount": sum(1 for d in districts if not d["name"].startswith("大字")),
        "tier1": sum(1 for d in districts if d["tier"] == 1),
        "tier2": sum(1 for d in districts if d["tier"] <= 2),
        "withPhotos": sum(1 for d in districts if d["photos"]),
        "cityPop": city_pop,
        "cityArea": city_area,
        "cityU15": out["city"]["u15"],
        "cityO65": out["city"]["o65"],
    }
    (ROOT / "content/data/map-quiz-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"Wrote {out_path} ({out_path.stat().st_size / 1024:.1f} KB), districts={len(districts)}, meta={meta}")


if __name__ == "__main__":
    main()
