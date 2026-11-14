"""
データのページ（/data/）の「年齢ごとの人口」のグラフ用データ content/data/age.json を作る。

  1. 枚方市「性別年齢別人口（2026年・月別）」の、最新の月の PDF を落とす
     https://www.city.hirakata.osaka.jp/0000053215.html
  2. python3 scripts/age-data.py <PDF> content/data/age.json

PDF は 1 歳ごとの男・女・計の表（住民基本台帳、毎月 1 日）。文字は PyMuPDF（fitz）で取り出す。
1 歳ごとの数を足したものが、表の「合計」「0～14」「15～64」「65～」と合うことを確かめてから書く。
このページには利用条件が書いていないので、ファイルは置かず、数字を読み取って出典を書く（人口の記事と同じ）。
"""
import json, re, sys

import fitz

pdf, out = sys.argv[1], sys.argv[2]
text = "\n".join(p.get_text() for p in fitz.open(pdf))
toks = [x.strip() for x in text.split("\n") if x.strip()]
num = lambda s: re.fullmatch(r"\d+", s) is not None

# 基準日（令和８年１１月１日）
z2h = str.maketrans("０１２３４５６７８９", "0123456789")
m = re.search(r"令和(\d+)年(\d+)月(\d+)日", text.translate(z2h))
date = f"{2018 + int(m.group(1))}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

ages = {}
totals = {}
for i in range(len(toks) - 3):
    if not all(num(toks[i + k]) for k in (1, 2, 3)):
        continue
    v = tuple(int(toks[i + k]) for k in (1, 2, 3))
    if m := re.fullmatch(r"(\d+)歳(～)?", toks[i]):
        ages[int(m.group(1))] = v  # 100歳～ は 100 に入れる（100歳以上）
    elif toks[i].replace("　", "") == "合計":
        totals["all"] = v
    elif toks[i] in ("0～14", "15～64", "65～"):
        totals[toks[i]] = v

assert sorted(ages) == list(range(0, 101)), sorted(set(range(101)) - set(ages))
for a, (m_, f_, t_) in ages.items():
    assert m_ + f_ == t_, a
s = lambda lo, hi: tuple(sum(ages[a][k] for a in range(lo, hi + 1)) for k in range(3))
assert s(0, 100) == totals["all"], (s(0, 100), totals["all"])
assert s(0, 14) == totals["0～14"] and s(15, 64) == totals["15～64"] and s(65, 100) == totals["65～"]

bands = []
for lo in range(0, 100, 5):
    m_, f_, t_ = s(lo, min(lo + 4, 100) if lo < 95 else 99)
    bands.append({"label": f"{lo}〜{lo + 4}歳", "male": m_, "female": f_})
m_, f_, _ = s(100, 100)
bands.append({"label": "100歳以上", "male": m_, "female": f_})

json.dump(
    {
        "_source": f"枚方市「性別年齢別人口（2026年・月別）」 https://www.city.hirakata.osaka.jp/0000053215.html の {date} の表（PDF）。住民基本台帳。scripts/age-data.py で読み取った",
        "date": date,
        "total": totals["all"][2],
        "groups": {"0-14": totals["0～14"][2], "15-64": totals["15～64"][2], "65+": totals["65～"][2]},
        "over75": s(75, 100)[2],
        "bands": bands,
    },
    open(out, "w"),
    ensure_ascii=False,
    indent=1,
)
print(date, totals["all"], {k: v[2] for k, v in totals.items()})
