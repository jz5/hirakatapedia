"""
図書館の記事（/library/）のグラフ用データ content/data/library.json を作る。

  python3 scripts/library-data.py <大阪府統計年鑑 18-1> <総務省 住基 市区町村別> content/data/library.json

  1. 大阪府統計年鑑 令和7年版 表18-1「公立図書館別蔵書・貸出図書冊数等」（令和6年度の貸出）
     https://www.pref.osaka.lg.jp/documents/128538/n2025-18-1~13.xlsx
  2. 総務省「住民基本台帳に基づく人口、人口動態及び世帯数（令和7年1月1日現在）」【総計】市区町村別
     https://www.soumu.go.jp/main_content/001023714.xlsx

枚方市の貸出冊数の移り変わりは、市の資料から書き写した（下の LENDING）。
"""
import json, re, sys
import openpyxl

nenkan, soumu, out = sys.argv[1:4]

# --- 枚方市立図書館の1年の貸出冊数（全館の合計） ---
# 1989〜2014年度：『枚方市立図書館四十年誌』資料「各館の貸出冊数の推移（平成元(1989)年～26(2014)年）」
#   https://www.city.hirakata.osaka.jp/cmsfiles/contents/0000003/3483/79354.pdf
# 2015年度：『図書館年報2016』 2016〜2025年度：『図書館年報 令和7年度』「図書館別貸出冊数の推移（最近10年間）」
#   https://www.city.hirakata.osaka.jp/cmsfiles/contents/0000036/36890/2025nennpou.pdf
LENDING = {
    1989: 1974859, 1990: 2218706, 1991: 2282487, 1992: 2388797, 1993: 2469365,
    1994: 2482370, 1995: 2493950, 1996: 2383787, 1997: 2434783, 1998: 2533036, 1999: 2489054,
    2000: 2532182, 2001: 2541898, 2002: 3073075, 2003: 3374671, 2004: 3236096,
    2005: 3534713, 2006: 3891967, 2007: 4061932, 2008: 4298454, 2009: 4419687,
    2010: 4284668, 2011: 4055660, 2012: 3912063, 2013: 3737454, 2014: 3666276,
    2015: 3638370, 2016: 3403142, 2017: 3442647, 2018: 3392614, 2019: 3332283,
    2020: 2659430, 2021: 3841278, 2022: 3816054, 2023: 3874892, 2024: 4103346, 2025: 4413171,
}

def muni(name):
    """設置者の欄から市町村名を取る。「枚方市立」「松原市民」「熊取町立熊取」「カ）太子町立図書館」→「枚方市」など。府立は「大阪府」"""
    name = re.sub(r"^[ア-ン]）", "", name.strip())
    if name.startswith("大阪府"):
        return "大阪府"
    m = re.match(r"^(.+?[市町村])", name)
    return m.group(1) if m else None


# --- 府内の市町村ごとの貸出冊数（令和6年度） ---
# 表は左右2段組み。左は 0列目＝設置者、1列目＝館名、7列目＝貸出。右は 9・10・16列目
# 設置者の欄が空の行は、上の設置者の館
ws = openpyxl.load_workbook(nenkan, read_only=True, data_only=True)["18-1"]
rows = list(ws.iter_rows(values_only=True))
lending, books, halls = {}, {}, {}
for city_col, name_col, lend_col in [(0, 1, 7), (9, 10, 16)]:
    book_col = lend_col - 4  # 蔵書冊数は貸出の4列左
    city = None
    for r in rows:
        if len(r) <= lend_col:
            continue
        c = r[city_col]
        if isinstance(c, str) and "。" not in c:  # 注記の行（「イ）令和５年２月20日をもって廃止。」など）は飛ばす
            city = muni(c) or city
        v = r[lend_col]
        if city and isinstance(v, (int, float)) and (r[name_col] is not None or isinstance(c, str)):
            lending[city] = lending.get(city, 0) + int(v)
            halls[city] = halls.get(city, 0) + 1  # 表に載っている館（図書館・分館・公民館図書室など）。枚方の分室は載っていない
            b = r[book_col]
            if isinstance(b, (int, float)):
                books[city] = books.get(city, 0) + int(b)

by_city = {k: v for k, v in lending.items() if k != "大阪府"}

# --- 人口（2025年1月1日） ---
ws = openpyxl.load_workbook(soumu, read_only=True, data_only=True).active
pop = {}
for r in ws.iter_rows(values_only=True):
    v = [c for c in r if c is not None]
    if len(v) > 5 and v[1] == "大阪府" and isinstance(v[2], str) and isinstance(v[5], (int, float)):
        pop[v[2].strip().split("郡")[-1]] = int(v[5])  # 「三島郡島本町」→「島本町」。府の合計は「-」

cities = sorted(
    (
        {"name": n, "population": pop[n], "lending": by_city[n], "perCapita": round(by_city[n] / pop[n], 2), "books": books.get(n, 0), "halls": halls[n]}
        for n in by_city
        if n in pop
    ),
    key=lambda c: -c["population"],
)
missing = [n for n in by_city if n not in pop]
if missing:
    print("人口が見つからない:", missing, file=sys.stderr)

json.dump(
    {
        "_source": "大阪府統計年鑑 令和7年版 表18-1（令和6年度）、総務省 住民基本台帳人口（2025年1月1日）、枚方市立図書館『四十年誌』『図書館年報』",
        "lending": [{"year": y, "books": n} for y, n in sorted(LENDING.items())],
        "cities": cities,
        # 府全体：府立図書館を含む、表18-1の全部の貸出 ÷ 府の人口
        "osaka": {"population": pop["-"], "lending": sum(lending.values()), "perCapita": round(sum(lending.values()) / pop["-"], 2)},
        # 全国：文部科学省「令和6年度社会教育調査」確定値 表6（令和5年度間の国民1人当たり貸出冊数）
        "japan": {"year": 2023, "perCapita": 4.8},
    },
    open(out, "w"),
    ensure_ascii=False,
    indent=1,
)
