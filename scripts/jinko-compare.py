"""
人口の記事（/jinko/）の、ほかの市と比べるグラフ用データ content/data/jinko-compare.json を作る。

  python3 scripts/jinko-compare.py <e-Stat 第6表 大阪府> <大阪府 R7 確定値 付表> <総務省 総計 市区町村> <総務省 外国人 市区町村> content/data/jinko-compare.json

  1. e-Stat 国勢調査 時系列データ 第6表「年齢（3区分），男女別人口及び年齢別割合 － 都道府県，市区町村（昭和55年～令和2年）」大阪府
     https://www.e-stat.go.jp/stat-search/file-download?statInfId=000001086001&fileKind=0
  2. 大阪府「令和7年国勢調査 大阪府の人口及び世帯数（確定値）」付表
     https://www.pref.osaka.lg.jp/documents/140351/r7census_osaka_kakutei_data.xlsx
  3. 総務省「住民基本台帳に基づく人口、人口動態及び世帯数（令和8年1月1日現在）」市区町村別（総計）
     https://www.soumu.go.jp/main_content/000892952.xlsx
  4. 同（外国人住民）
     https://www.soumu.go.jp/main_content/000892960.xlsx
"""
import json, sys
import openpyxl

ts, r7, soumu_total, soumu_foreign, out = sys.argv[1:6]

# 市町村だけにする（大阪市の区 27101〜27139、堺市の区 27141〜27149、府の合計を除く）
def is_muni(code):
    code = str(code)
    code = int(code[:5])  # 総務省の表は検査数字つきの6桁
    return not (code == 27000 or 27101 <= code <= 27139 or 27141 <= code <= 27149)

# --- 国勢調査の人口（1980〜2020年は e-Stat、2025年は府の付表）---
pops = {}
wb = openpyxl.load_workbook(ts, read_only=True, data_only=True)
for sn in ["昭和55年", "昭和60年", "平成2年", "平成7年", "平成12年", "平成17年", "平成22年", "平成27年_原数値", "令和2年_原数値"]:
    for r in wb[sn].iter_rows(values_only=True):
        v = [c for c in r if c is not None]
        if len(v) > 4 and isinstance(v[0], str) and v[0].endswith("年") and str(v[2]).isdigit() and is_muni(v[2]):
            pops.setdefault(int(v[0][:4]), {})[v[3].strip()] = v[4]
wb = openpyxl.load_workbook(r7, data_only=True)
for r in wb["付表"].iter_rows(values_only=True):
    v = [c for c in r if c is not None]
    if len(v) >= 7 and isinstance(v[3], int) and str(v[0]).strip().endswith(("市", "町", "村")) and not str(v[0]).startswith(" "):
        pops.setdefault(2025, {})[str(v[0]).strip()] = v[3]

years = sorted(pops)
top10 = sorted({n for y in years for n, _ in sorted(pops[y].items(), key=lambda kv: -kv[1])[:10]})
ranks = []
for y in years:
    order = [n for n, _ in sorted(pops[y].items(), key=lambda kv: -kv[1])]
    ranks.append({"year": y, "count": len(order), "cities": {n: {"rank": order.index(n) + 1, "population": pops[y][n]} for n in top10}})

# --- 外国人の割合（2026年1月1日）と 2025年の増減 ---
def load(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    return {(r[1], r[2]): r for r in ws.iter_rows(min_row=7, values_only=True) if r and r[0]}

T, F = load(soumu_total), load(soumu_foreign)
def foreign_row(key, name):
    t, f = T[key], F[key]
    return {"name": name, "population": t[5], "foreign": f[5], "share": round(f[5] / t[5] * 100, 2),
            "foreignChange": f[23], "foreignChangeRate": round(f[24], 2), "foreignSocial": f[27]}

foreign = [foreign_row(("合計", "-"), "全国"), foreign_row(("大阪府", "-"), "大阪府")]
# 「泉北郡」のような郡の合計の行も除く
munis = [k for k in T if k[0] == "大阪府" and k[1] != "-" and not k[1].endswith("郡") and is_muni(T[k][0])]
allm = [foreign_row(k, k[1]) for k in munis]
for m in allm:
    m["shareRank"] = sorted(allm, key=lambda x: -x["share"]).index(m) + 1
foreign_cities = [m for m in allm if m["name"] in top10]

# 枚方市の 2025年の社会増減（総計と外国人）
ht, hf = T[("大阪府", "枚方市")], F[("大阪府", "枚方市")]
hirakata2025 = {"social": ht[23], "natural": ht[21], "foreignSocial": hf[27], "muniCount": len(allm)}

json.dump({
    "_source": {
        "ranks": "国勢調査。1980〜2020年は e-Stat 時系列データ 第6表（大阪府、2015・2020年は原数値）、2025年は大阪府「令和7年国勢調査（確定値）」付表。その年の市町村の境界のまま",
        "foreign": "総務省「住民基本台帳に基づく人口、人口動態及び世帯数（令和8年1月1日現在）」市区町村別（総計・外国人住民）。増減は2025年1〜12月",
    },
    "ranks": ranks,
    "foreign": foreign,
    "foreignCities": foreign_cities,
    "hirakata2025": hirakata2025,
}, open(out, "w"), ensure_ascii=False, indent=1)
print(top10, ranks[-1]["cities"]["枚方市"], foreign[:2], hirakata2025, [(m["name"], m["share"], m["shareRank"]) for m in foreign_cities])
