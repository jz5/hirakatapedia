"""
地形を 3D で見るページ（/data/chikei/）の、細かい画像と古い空中写真・細かい標高を作る。

  python3 scripts/chikei-tiles.py [タイルを置いておくフォルダー]

scripts/chikei-data.py と同じ範囲（ズーム 14 のタイル 12×12 枚）を 16×16 の区画に分けて、近づいたときに読む画像を作る。
  public/maps/chikei/t/<写真>/<ズーム>/<列>-<行>.avif   区画ごとの空中写真（ズーム 16 は 768 ドット四方、15 は 384）
  public/maps/chikei/t/<写真>/base.avif                  範囲全体の古い空中写真（3072 ドット四方。最新はもとの photo.jpg）
  public/maps/chikei/t/heights-fine.png                  細かい標高（1536×1536、約 16m ごと。形は heights.png と同じ）
  content/data/chikei-layers.json                        写真の一覧（ページと 3D の本体が読む）
画像は大きいので Git に入れない（.gitignore）。公開するときに scripts/deploy.sh がこのスクリプトを走らせ、無いものだけ作る。
地理院タイルを約 5,000 枚取る（1 回目だけ。タイルはフォルダーに残し、作った画像があれば取り直さない）。

古い空中写真は、写真の無い所を灰色で埋める（1936〜1942年頃は範囲の 4 割ほどしか無い）。
細かい標高は、標高タイル 5A（5m メッシュ、航空レーザー）の平均。値の無い所は 10m メッシュ（標高タイル）で埋める。
Pillow（AVIF が使えるもの）と numpy、curl が要る。
"""
import json, os, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "maps", "chikei", "t")
LAYERS_JSON = os.path.join(ROOT, "content", "data", "chikei-layers.json")
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "chikei-tiles")
UA = "chikei-data/1.0"

Z, X0, Y0, NT = 14, 14361, 6493, 12  # scripts/chikei-data.py と同じ範囲
P = 16  # 区画の数（1 辺）
GRAY = (176, 180, 180)  # 写真の無い所

# 写真の一覧（新しい順）。key は画像のフォルダー名、layer は地理院タイルの名前、zooms は区画の画像を作るズーム。最新の写真の撮影年は、国土地理院の「全国最新写真（シームレス）撮影期間」（seamlessphoto_spec）で調べた
# （2026-11-17。市内は 2021〜2022年、範囲全体の 9 割以上が 2020〜2022年。残りは 2007〜2017年）
PHOTOS = [
    {"key": "photo", "layer": "seamlessphoto", "ext": "jpg", "name": "最新（2020〜2022年）", "zooms": [15, 16]},
    {"key": "y1974", "layer": "gazo1", "ext": "jpg", "name": "1974〜1978年", "zooms": [15], "old": True},
    {"key": "y1961", "layer": "ort_old10", "ext": "png", "name": "1961〜1969年", "zooms": [15], "old": True, "gray": True},
    {"key": "y1945", "layer": "ort_USA10", "ext": "png", "name": "1945〜1950年", "zooms": [15], "old": True, "gray": True},
    {"key": "y1936", "layer": "ort_riku10", "ext": "png", "name": "1936〜1942年頃", "zooms": [15], "old": True, "gray": True},
]


def fetch(url, path):
    """取れたら True。404（写真の無い所）は False。同じタイルを別のスレッドが取っても壊れないよう、別の名前で取ってから置き換える"""
    if os.path.exists(path):
        return os.path.getsize(path) > 0
    tmp = f"{path}.{threading.get_ident()}"
    r = subprocess.run(["curl", "-s", "-A", UA, "-o", tmp, "-w", "%{http_code}", url], capture_output=True, text=True)
    code = r.stdout.strip()
    if code == "404":
        open(tmp, "wb").close()  # 無いことを覚えておく
    elif code != "200":
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"{code} {url}")
    os.replace(tmp, path)
    time.sleep(0.03)
    return code == "200"


def tile(layer, ext, z, x, y):
    """タイル 1 枚（RGB）。無い所・透明な所は灰色"""
    path = os.path.join(CACHE, layer, str(z), f"{x}_{y}.{ext}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not fetch(f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.{ext}", path):
        return Image.new("RGB", (256, 256), GRAY)
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, GRAY + (255,))
        bg.alpha_composite(im)
        return bg.convert("RGB")
    return im.convert("RGB")


def region(p, z, px0, py0, size):
    """ズーム z の、範囲の左上からのドット位置 (px0, py0) から size 四方の画像"""
    tx0, ty0 = X0 * 2 ** (z - Z), Y0 * 2 ** (z - Z)
    a, b = px0 // 256, py0 // 256
    c, d = (px0 + size - 1) // 256, (py0 + size - 1) // 256
    im = Image.new("RGB", ((c - a + 1) * 256, (d - b + 1) * 256))
    for i in range(a, c + 1):
        for j in range(b, d + 1):
            im.paste(tile(p["layer"], p["ext"], z, tx0 + i, ty0 + j), ((i - a) * 256, (j - b) * 256))
    return im.crop((px0 - a * 256, py0 - b * 256, px0 - a * 256 + size, py0 - b * 256 + size))


def save(im, path, gray=False, quality=60):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    (im.convert("L") if gray else im).save(path, quality=quality, speed=6)


def make_photo(p):
    jobs = []
    if p.get("old"):
        out = os.path.join(OUT, p["key"], "base.avif")
        if not os.path.exists(out):
            jobs.append(("base", out))
    for z in p["zooms"]:
        for ci in range(P):
            for cj in range(P):
                out = os.path.join(OUT, p["key"], str(z), f"{ci}-{cj}.avif")
                if not os.path.exists(out):
                    jobs.append((z, ci, cj, out))
    print(f"{p['name']}：作る画像 {len(jobs)}")

    def run(job):
        if job[0] == "base":
            save(region(p, Z, 0, 0, NT * 256), job[1], p.get("gray"), 58)
            return
        z, ci, cj, out = job
        size = NT * 256 * 2 ** (z - Z) // P
        save(region(p, z, ci * size, cj * size, size), out, p.get("gray"))

    with ThreadPoolExecutor(4) as ex:
        for n, _ in enumerate(ex.map(run, jobs), 1):
            if n % 64 == 0:
                print(f"  {n}/{len(jobs)}")


def make_fine_heights():
    out = os.path.join(OUT, "heights-fine.png")
    if os.path.exists(out):
        return
    N = 1536

    def dem(layer, z):
        """標高（m）と、値があるかどうか。タイル：x = 2^16 R + 2^8 G + B。x < 2^23 なら 0.01x m、2^23 は値なし、それより上は負"""
        k = 2 ** (z - Z)
        size = NT * 256 * k
        h = np.zeros((size, size), np.float32)
        ok = np.zeros((size, size), bool)
        for i in range(NT * k):
            for j in range(NT * k):
                path = os.path.join(CACHE, layer, str(z), f"{X0 * k + i}_{Y0 * k + j}.png")
                os.makedirs(os.path.dirname(path), exist_ok=True)
                if not fetch(f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{X0 * k + i}/{Y0 * k + j}.png", path):
                    continue
                a = np.asarray(Image.open(path).convert("RGB")).astype(np.int64)
                v = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
                sl = (slice(j * 256, (j + 1) * 256), slice(i * 256, (i + 1) * 256))
                h[sl] = np.where(v < 2 ** 23, v * 0.01, (v - 2 ** 24) * 0.01)
                ok[sl] = v != 2 ** 23
        return h, ok

    h10, ok10 = dem("dem_png", 14)
    h5, ok5 = dem("dem5a_png", 15)
    h10[~ok10] = 0
    up = np.repeat(np.repeat(h10, 2, 0), 2, 1)  # 10m を 5m の並びに
    h = np.where(ok5, h5, up)
    f = h.shape[0] // N
    hs = h.reshape(N, f, N, f).mean(axis=(1, 3))
    enc = np.round((hs + 100) * 50).astype(np.int64)
    assert enc.min() >= 0 and enc.max() < 65536
    rgb = np.zeros((N, N, 3), np.uint8)
    rgb[..., 0] = enc >> 8
    rgb[..., 1] = enc & 255
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(rgb).save(out, optimize=True)
    print(f"細かい標高：5m メッシュの無い所 {100 * (1 - ok5.mean()):.1f}%")


def main():
    os.makedirs(CACHE, exist_ok=True)
    layers = [{k: p[k] for k in ("key", "name", "zooms")} | {"old": bool(p.get("old"))} for p in PHOTOS]
    with open(LAYERS_JSON, "w", encoding="utf-8") as fp:
        json.dump({"_source": "scripts/chikei-tiles.py で作る。画像は public/maps/chikei/t/（Git に入れない）", "chunks": P, "photos": layers}, fp, ensure_ascii=False, indent=1)
        fp.write("\n")
    make_fine_heights()
    for p in PHOTOS:
        make_photo(p)


main()
