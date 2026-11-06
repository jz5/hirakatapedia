"""
暑さの記事（/atsui/）のグラフ用データ content/data/atsui.json を作る。

  python3 scripts/atsui-data.py <枚方.html> <大阪.html> <京都.html> content/data/atsui.json

気象庁「過去の気象データ検索」の年ごとの値（日数）のページを curl で保存して渡す。
  枚方（アメダス）: https://www.data.jma.go.jp/stats/etrn/view/annually_a.php?prec_no=62&block_no=1065&view=a2
  大阪（気象台）  : https://www.data.jma.go.jp/stats/etrn/view/annually_s.php?prec_no=62&block_no=47772&view=a2
  京都（気象台）  : https://www.data.jma.go.jp/stats/etrn/view/annually_s.php?prec_no=61&block_no=47759&view=a2

表の右から「日最低≧25℃（熱帯夜の目安）・日最高＜0℃・≧25℃・≧30℃・≧35℃（猛暑日）・蒸気圧・湿度・最小湿度・その日」の順。
「]」（資料不足値）と「///」の年は使わない。
"""
import html, json, re, sys

*files, out = sys.argv[1:]
BASE = "https://www.data.jma.go.jp/stats/etrn/view/"
STATIONS = [
    ("枚方", BASE + "annually_a.php?prec_no=62&block_no=1065&year=&month=&day=&view=a2"),
    ("大阪", BASE + "annually_s.php?prec_no=62&block_no=47772&year=&month=&day=&view=a2"),
    ("京都", BASE + "annually_s.php?prec_no=61&block_no=47759&year=&month=&day=&view=a2"),
]
# 枚方のアメダスは 1993年に場所を移した（その年は欠測）。前後で比べられないので、移したあとの 1994年から
# 枚方市「枚方市の地域特性について」（平成29年度 環境審議会資料）図2「※1993年は測定地点移設のため欠測」
FIRST = 1994

def rows(path):
    s = open(path, encoding="utf-8").read()
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if cells and re.fullmatch(r"\d{4}", cells[0]):
            yield cells

def value(cell):
    if "]" in cell or "/" in cell or cell in ("", "×", "--"):
        return None
    return int(float(cell.replace(")", "")))

data = {}
for (name, _), path in zip(STATIONS, files):
    for r in rows(path):
        y = int(r[0])
        if y < FIRST:
            continue
        data.setdefault(y, {})[name] = {"mosho": value(r[-5]), "nettaiya": value(r[-9])}

years = [y for y in sorted(data) if all(n in data[y] for n, _ in STATIONS) and y < 2026]
json.dump(
    {
        "_source": "気象庁「過去の気象データ検索」年ごとの値（日数） " + " / ".join(u for _, u in STATIONS),
        "stations": [n for n, _ in STATIONS],
        "years": [{"year": y, **{n: data[y][n] for n, _ in STATIONS}} for y in years],
    },
    open(out, "w"),
    ensure_ascii=False,
    indent=1,
)
