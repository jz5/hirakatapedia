"""
地形を 3D で見るページ（/data/chikei/）のデータを作る。

  python3 scripts/chikei-data.py [タイルを置いておくフォルダー]

枚方市を中心に約 24km 四方（ズーム 14 のタイル 12×12 枚）について、国土地理院の地理院タイルを取ってきて、
  public/maps/chikei/heights.png  標高（768×768。赤と緑の 2 バイトで (標高 + 100) × 50 の整数）
  public/maps/chikei/photo.jpg    シームレス空中写真（3072×3072）
  public/maps/chikei/pale.jpg     淡色地図（2048×2048）
  content/data/chikei.json        範囲・市の境界・地名・市内の標高の幅
を作る。タイルは 432 枚（約 20MB）。フォルダーを渡すと、2 回目からは取り直さない。

市の境界は OpenStreetMap（relation 358609、ODbL）。地名の位置は地理院地図の地名検索で調べて下の表に書いた。
山の位置と高さは、表の位置の近く（約 350m 四方）で標高タイルの値が最大のところ（三角点の標高とは少し違う）。
Pillow と numpy、curl が要る。
"""
import json, math, os, subprocess, sys, tempfile, time
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "maps", "chikei")
META = os.path.join(ROOT, "content", "data", "chikei.json")
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "chikei-tiles")

Z, X0, X1, Y0, Y1 = 14, 14361, 14372, 6493, 6504
N = 768  # 標高のマスの数（1 辺）。約 31m ごと
UA = "chikei-data/1.0"
LAYERS = (("dem_png", "png", "dem"), ("seamlessphoto", "jpg", "photo"), ("pale", "png", "pale"))

# 駅・公園など（市内）
SPOTS = [
    ("枚方市駅", 34.816102, 135.648645), ("樟葉駅", 34.861897, 135.675593), ("長尾駅", 34.825633, 135.713166),
    ("津田駅", 34.801393, 135.698159), ("牧野駅", 34.843753, 135.665577), ("ひらかたパーク", 34.805727, 135.637147),
    ("山田池公園", 34.823149, 135.691262),
]
RIVERS = [("淀川", 34.8205, 135.6375)]
PEAKS = [
    ("国見山", 34.796460, 135.715208), ("交野山", 34.786577, 135.709539), ("男山", 34.879684, 135.694809),
    ("天王山", 34.901930, 135.676425), ("飯盛山", 34.726505, 135.653567),
]
# まわりの市と町（役所の位置）
TOWNS = [
    ("高槻市", 34.84602, 135.617325), ("八幡市", 34.875439, 135.707123), ("交野市", 34.787968, 135.680008),
    ("寝屋川市", 34.766109, 135.628052), ("京田辺市", 34.814434, 135.767715), ("島本町", 34.883446, 135.662796),
    ("四條畷市", 34.740002, 135.63945), ("大山崎町", 34.902779, 135.688614), ("茨木市", 34.816387, 135.568604),
    ("摂津市", 34.777222, 135.562225),
]


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    # curl で取る（macOS の python.org 版の Python は、証明書を入れていないと https で止まるため）
    subprocess.run(["curl", "-sf", "-A", UA, "-o", path, url], check=True)
    time.sleep(0.05)


def stitch(name, ext, mode):
    w, h = (X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256
    im = Image.new(mode, (w, h))
    for x in range(X0, X1 + 1):
        for y in range(Y0, Y1 + 1):
            im.paste(Image.open(os.path.join(CACHE, f"{name}_{x}_{y}.{ext}")).convert(mode), ((x - X0) * 256, (y - Y0) * 256))
    return im


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for layer, ext, name in LAYERS:
        for x in range(X0, X1 + 1):
            for y in range(Y0, Y1 + 1):
                fetch(f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{Z}/{x}/{y}.{ext}", os.path.join(CACHE, f"{name}_{x}_{y}.{ext}"))
    boundary = os.path.join(CACHE, "boundary-osm.json")
    fetch("https://nominatim.openstreetmap.org/lookup?osm_ids=R358609&format=geojson&polygon_geojson=1", boundary)

    nx, ny, n = X1 - X0 + 1, Y1 - Y0 + 1, 2 ** Z
    W, H = nx * 256, ny * 256

    # 標高タイル：x = 2^16 R + 2^8 G + B。x < 2^23 なら 0.01x m、2^23 は値なし、それより上は負
    dem = np.asarray(stitch("dem", "png", "RGB")).astype(np.int64)
    v = dem[..., 0] * 65536 + dem[..., 1] * 256 + dem[..., 2]
    h = np.where(v < 2 ** 23, v * 0.01, (v - 2 ** 24) * 0.01)
    h[v == 2 ** 23] = 0
    f = W // N
    hs = h.reshape(N, f, N, f).mean(axis=(1, 3))
    enc = np.round((hs + 100) * 50).astype(np.int64)
    assert enc.min() >= 0 and enc.max() < 65536
    rgb = np.zeros((N, N, 3), np.uint8)
    rgb[..., 0] = enc >> 8
    rgb[..., 1] = enc & 255
    Image.fromarray(rgb).save(os.path.join(OUT, "heights.png"), optimize=True)
    stitch("photo", "jpg", "RGB").save(os.path.join(OUT, "photo.jpg"), quality=76, optimize=True, progressive=True)
    stitch("pale", "png", "RGB").resize((2048, 2048), Image.Resampling.LANCZOS).save(os.path.join(OUT, "pale.jpg"), quality=82, optimize=True)

    def uv(lat, lon):
        x = (lon + 180) / 360 * n
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return (x - X0) / nx, (y - Y0) / ny

    def latlon(u, w):
        lon = (u * nx + X0) / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (w * ny + Y0) / n))))
        return [round(lat, 6), round(lon, 6)]

    def peak(lat, lon, r=22):
        u, w = uv(lat, lon)
        px, py = int(u * W), int(w * H)
        sub = h[py - r:py + r + 1, px - r:px + r + 1]
        iy, ix = np.unravel_index(sub.argmax(), sub.shape)
        return (px - r + ix + .5) / W, (py - r + iy + .5) / H, float(sub.max())

    geo = json.load(open(boundary, encoding="utf-8"))["features"][0]["geometry"]
    polys = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
    rings = []
    for poly in polys:
        pts = [uv(la, lo) for lo, la in poly[0]]
        if len(pts) > 20:
            rings.append([[round(a, 5), round(b, 5)] for a, b in pts])

    labels = []
    for kind, rows in (("spot", SPOTS), ("river", RIVERS), ("town", TOWNS)):
        for name, la, lo in rows:
            u, w = uv(la, lo)
            labels.append({"n": name, "k": kind, "u": round(u, 5), "v": round(w, 5)})
    for name, la, lo in PEAKS:
        u, w, e = peak(la, lo)
        labels.append({"n": name, "k": "peak", "u": round(u, 5), "v": round(w, 5), "e": round(e)})

    mask = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(mask)
    for r in rings:
        d.polygon([(a * N, b * N) for a, b in r], fill=255)
    city = hs[np.asarray(mask) > 0]
    center = latlon(.5, .5)
    meta = {
        "_source": "標高・空中写真・地図は国土地理院の地理院タイル（標高タイル・シームレス空中写真・淡色地図）を加工して作成。市の境界は OpenStreetMap（relation 358609、© OpenStreetMap contributors、ODbL）。scripts/chikei-data.py で作る",
        "n": N,
        "sizeM": round(40075016.686 * math.cos(math.radians(center[0])) / n * nx, 1),
        "nw": latlon(0, 0),
        "se": latlon(1, 1),
        "cityMin": round(float(city.min()), 1),
        "cityMax": round(float(city.max()), 1),
        "rings": rings,
        "labels": labels,
    }
    with open(META, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, separators=(",", ":"))
        fp.write("\n")
    print("市内の標高", meta["cityMin"], "〜", meta["cityMax"], "m／境界の点", [len(r) for r in rings], "／山", [(l["n"], l["e"]) for l in labels if l["k"] == "peak"])


main()
