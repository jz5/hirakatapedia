"""
データのページ（/data/）の「市のデータの一覧」 content/data/opendata-catalog.json を作る。

  python3 scripts/opendata-catalog.py

- 載せるページと、読む人向けの題名・説明は content/data/opendata-pages.yaml（手で書く）
- このスクリプトは、各ページを 1 秒おきに開いて、ファイルのリンク（名前・形式・大きさ）、公開日・更新日、
  利用条件（CC BY 2.1 / CC BY-ND 2.1 のリンクがあるか）を拾う
- ページが無くなっていたら status: gone にして知らせる
- 市の「オープンデータ」のカテゴリページと「オープンデータ一覧」の CSV を見て、yaml に無いページがあれば知らせる
  （市が新しいデータを出したとき、気づけるように）

市のサーバーに負担をかけないよう、ページは 1 回ずつ、1 秒おき。ファイルそのものは落とさない。
"""
import csv, html, io, json, re, subprocess, sys, time
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "data" / "opendata-pages.yaml"
OUT = ROOT / "content" / "data" / "opendata-catalog.json"
SITE = "https://www.city.hirakata.osaka.jp/"
UA = "Mozilla/5.0 (compatible; hirakatapedia-build; +https://hirakata.pronama.jp/)"
LIC = {
    "CC BY 2.1 JP": "https://creativecommons.org/licenses/by/2.1/jp/",
    "CC BY-ND 2.1 JP": "https://creativecommons.org/licenses/by-nd/2.1/jp/",
}
# オープンデータのカテゴリ（分野ごと）。番号は市のサイトの分け方
CATEGORY_PAGES = [f"{SITE}category/6-15-2-{n}-0-0-0-0-0-0.html" for n in (1, 2, 3, 4, 5, 7, 8, 10, 11)]
LIST_CSV = f"{SITE}cmsfiles/contents/0000000/39/hirakata_opendatalist.csv"


def get(url):
    """(HTTP の状態, 中身)。curl を使う（手元の Python は証明書の設定がないことがあるので）"""
    r = subprocess.run(["curl", "-sL", "--max-time", "60", "-A", UA, "-w", "\n%{http_code}", url], capture_output=True)
    body, _, code = r.stdout.rpartition(b"\n")
    time.sleep(1)
    return int(code or 0), body


def text_of(h):
    return html.unescape(re.sub(r"<[^>]+>", "", h))


def jdate(s):
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s or "")
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def parse_page(h):
    """市のページから、題名・日付・ファイル・利用条件を拾う"""
    page = h.decode("utf-8", "replace")
    title = text_of((re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S) or [None, ""])[1]).strip()
    flat = text_of(page)
    pub = jdate((re.search(r"公開日：([^\]]+)", flat) or [None, ""])[1])
    upd = jdate((re.search(r"更新日：([^\]]+)", flat) or [None, ""])[1])
    # 本文（main_outline）だけを見る。右の列や下のリンクを拾わないように
    body = page.split("main_outline", 1)[-1].split("<h2>お問い合わせ", 1)[0]
    files = []
    for href, inner in re.findall(r'<a[^>]+href="([^"]*cmsfiles/[^"]+)"[^>]*>(.*?)</a>', body, re.S):
        label = re.sub(r"\s+", " ", text_of(inner)).strip()
        m = re.search(r"[(（]([^()（）]*?形式)?[、,]?\s*([\d.,]+\s*[KMG]?B)\s*[)）]\s*$", label)
        size = m.group(2).replace(" ", "") if m else None
        # 後ろの「(PDF形式、66.50KB)」「【CSV形式】」を外す（2 つ続いていることもある）
        while True:
            l2 = re.sub(r"\s*([(（][^()（）]*(形式|ファイル名|KB|MB)[^()（）]*[)）]|【[^】]*形式】)\s*$", "", label).strip()
            if l2 == label:
                break
            label = l2
        url = href if href.startswith("http") else SITE + re.sub(r"^\./", "", href)
        ext = url.rsplit(".", 1)[-1].lower()
        fmt = {"jpg": "JPEG", "jpeg": "JPEG"}.get(ext, ext.upper())
        if not any(f["url"] == url for f in files):
            files.append({"url": url, "label": label or None, "format": fmt, "size": size})
    lic = "CC BY-ND 2.1 JP" if "licenses/by-nd/2.1" in body else "CC BY 2.1 JP" if "licenses/by/2.1" in body else None
    return {"cityTitle": title, "published": pub, "updated": upd, "files": files, "license": lic}


def find_new(known):
    """市のオープンデータのカテゴリと一覧の CSV にあって、yaml に無いページ番号"""
    seen, per_cat = set(), []
    for u in CATEGORY_PAGES:
        code, h = get(u)
        if code != 200:
            print(f"  ! カテゴリページが開けない {code} {u}")
            continue
        ids = set(re.findall(r'city\.hirakata\.osaka\.jp/(\d{10})\.html', h.decode("utf-8", "replace")))
        per_cat.append(ids)
        seen |= ids
    # どのカテゴリページにも出てくるもの（右の列・下のリンク）は除く
    common = set.intersection(*per_cat) if per_cat else set()
    code, b = get(LIST_CSV)
    if code == 200:
        for row in csv.DictReader(io.StringIO(b.decode("cp932", "replace"))):
            seen |= set(re.findall(r"(\d{10})", row.get("URL", "")))
    ignore = {"0000000039", "0000017270", "0000017273", "0000017296"}  # 一覧・利用条件・取り組み・活用事例
    return sorted(seen - common - ignore - set(known))


def report_new(new, ignored):
    """yaml に無いページを開いて、題名を出す。404 は市の一覧に残っている切れたリンク"""
    found, dead = [], []
    for i in new:
        if i in ignored:
            continue
        code, h = get(f"{SITE}{i}.html")
        (found if code == 200 else dead).append(f"  {i} {parse_page(h)['cityTitle'] if code == 200 else f'（{code}）'}")
    if found:
        print("\nyaml に無いページ（新しいデータかもしれない。見て、要るものは pages に、要らないものは ignore に足す）:\n" + "\n".join(found))
    if dead:
        print("\n市の一覧にあるが、ページが無いもの（ignore に足す）:\n" + "\n".join(dead))


def main():
    src = yaml.safe_load(SRC.read_text())
    out, gone = [], []
    for p in src["pages"]:
        url = f"{SITE}{p['id']}.html"
        code, h = get(url)
        e = {k: p.get(k) for k in ("id", "category", "title", "desc", "inList", "view", "note") if p.get(k) is not None}
        e["page"] = url
        if code != 200:
            e["status"] = "gone"
            gone.append(f"{p['id']} {p['title']}（{code}）")
        else:
            e.update(parse_page(h), status="ok")
            e["licenseUrl"] = LIC.get(e["license"])
        out.append(e)
        print(f"{'✓' if code == 200 else '✗'} {p['id']} {p['title']}：ファイル {len(e.get('files', []))}")
    new = find_new([p["id"] for p in src["pages"]])

    OUT.write_text(
        json.dumps(
            {
                "_source": "枚方市の各ページ（content/data/opendata-pages.yaml の id）から scripts/opendata-catalog.py で取ってきた。題名と説明は yaml に手で書いたもの",
                "generated": date.today().isoformat(),
                "datasets": out,
                "external": src.get("external", []),
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n"
    )
    if gone:
        print("\n無くなったページ（yaml から外すか、移った先に直す）:\n  " + "\n  ".join(gone))
    report_new(new, set(str(x) for x in src.get("ignore", [])))


if __name__ == "__main__":
    sys.exit(main())
