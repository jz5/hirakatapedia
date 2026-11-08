"""
データのページ（/data/）で見せる、枚方市のオープンデータを取ってくる。

  python3 scripts/opendata-data.py            … 全部
  python3 scripts/opendata-data.py aed gomi   … id を指定したものだけ

- 市のデータのページを開いて、いまのファイルの URL を拾う（ファイル名は更新のたびに変わる）
- CSV は Shift_JIS（cp932）、Excel は openpyxl で読む（マクロ付きの xlsm も、値を読むだけ）
- public/opendata/<id>.json に、列と行を UTF-8 で置く。ブラウザはこれを読む
- content/data/opendata.json に、データごとの題名・出典・取ってきた日・行数を書く（ページの見出しに使う）

市のオープンデータは CC BY 2.1 JP。表に組み直すのは「改変」にあたるので、ページには
「この表は以下の著作物を改変して利用しています。」と、データの題名・枚方市・ライセンスを出す
（https://www.city.hirakata.osaka.jp/0000017270.html の表示例 (2)）。
"""
import csv, io, json, math, re, subprocess, sys, time
from datetime import date
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "opendata"
META = ROOT / "content" / "data" / "opendata.json"
SITE = "https://www.city.hirakata.osaka.jp"
UA = "Mozilla/5.0 (compatible; hirakatapedia-build; +https://hirakata.pronama.jp/)"


def get(url):
    # 手元の Python は証明書の設定がないことがあるので、curl で取る
    return subprocess.run(["curl", "-sSfL", "--max-time", "60", "-A", UA, url], check=True, capture_output=True).stdout


def file_url(page, pattern):
    """データのページから、pattern に合うファイルのリンクを拾う"""
    html = get(page).decode("utf-8", "replace")
    hrefs = re.findall(r'href="([^"]*/cmsfiles/[^"]+)"', html)
    hit = [h for h in hrefs if re.search(pattern, h)]
    if not hit:
        raise SystemExit(f"{page} に {pattern} のファイルが見つからない（{hrefs}）")
    h = hit[0]
    return h if h.startswith("http") else SITE + h


def read_csv(url):
    t = get(url).decode("cp932")
    rows = list(csv.reader(io.StringIO(t)))
    head = [re.sub(r"\s+", "", h) for h in rows[0]]  # 見出しの改行・空白を取る
    return [dict(zip(head, r)) for r in rows[1:] if any(c.strip() for c in r)]


def read_xlsx(url, sheet):
    wb = openpyxl.load_workbook(io.BytesIO(get(url)), read_only=True, data_only=True)
    it = wb[sheet].iter_rows(values_only=True)
    head = [re.sub(r"\s+", "", str(h)) if h is not None else "" for h in next(it)]
    out = []
    for r in it:
        if not any(c not in (None, "") for c in r):
            continue
        out.append({h: ("" if v is None else str(v).strip()) for h, v in zip(head, r) if h})
    return out


def s(v):
    return (v or "").strip().replace("　", " ").strip()


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


# --- 平面直角座標（第VI系、原点 北緯36度・東経136度）→ 緯度経度。GRS80、Krüger の級数 ---
def plane_to_latlon(x_north, y_east, lat0=36.0, lon0=136.0):
    a, f, m0 = 6378137.0, 1 / 298.257222101, 0.9999
    n = f / (2 - f)
    A_ = a / (1 + n) * (1 + n**2 / 4 + n**4 / 64)
    alpha = [n / 2 - 2 * n**2 / 3 + 5 * n**3 / 16, 13 * n**2 / 48 - 3 * n**3 / 5, 61 * n**3 / 240]
    beta = [n / 2 - 2 * n**2 / 3 + 37 * n**3 / 96, n**2 / 48 + n**3 / 15, 17 * n**3 / 480]
    delta = [2 * n - 2 * n**3 / 3, 7 * n**2 / 3 - 8 * n**3 / 5, 56 * n**3 / 15]
    phi0 = math.radians(lat0)
    # 原点の緯度までの子午線弧長
    t0 = math.atanh(math.sin(phi0)) - 2 * math.sqrt(n) / (1 + n) * math.atanh(2 * math.sqrt(n) / (1 + n) * math.sin(phi0))
    xi0 = math.atan(math.sinh(t0))  # 等角緯度
    S0 = A_ * (xi0 + sum(alpha[j] * math.sin(2 * (j + 1) * xi0) for j in range(3)))
    xi = (x_north + m0 * S0) / (m0 * A_)
    eta = y_east / (m0 * A_)
    xi2 = xi - sum(beta[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    eta2 = eta - sum(beta[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    chi = math.asin(math.sin(xi2) / math.cosh(eta2))
    lat = chi + sum(delta[j] * math.sin(2 * (j + 1) * chi) for j in range(3))
    lon = math.radians(lon0) + math.atan(math.sinh(eta2) / math.cos(xi2))
    return round(math.degrees(lat), 6), round(math.degrees(lon), 6)


# --- データごとの組み立て。columns は [列名, 種類]。種類: text / num / flag / long ---
# ごみの区分。市のデータの書き方がばらばら（「空き缶、びん」と「空き缶・びん」、改行で 2 つ並べたもの）なので、
# 絞り込みは「この言葉を含むか」で見る。[絞り込みに出す名前, 含む言葉]
GOMI_KINDS = [
    ["一般ごみ", "一般ごみ"],
    ["粗ごみ", "粗ごみ"],
    ["大型ごみ", "大型"],
    ["ペットボトル・プラ", "ペットボトル"],
    ["空き缶・びん・ガラス", "空き缶"],
    ["紙類", "紙類"],
    ["処理困難物", "処理困難物"],
    ["家電リサイクル", "家電リサイクル"],
    ["パソコン", "ＰＣ"],
    ["市で集めないもの", "市で"],
    ["臨時ごみ", "臨時"],
    ["分別回収", "分別回収"],
]


def gomi_kind(v):
    v = re.sub(r"\n+", "／", s(v)).replace("空き缶・びん", "空き缶、びん")
    return v


def gomi():
    page = f"{SITE}/0000024067.html"
    url = file_url(page, r"gomibunbetu.*\.xlsm$")
    rows = [
        [s(r["ごみ品名"]), s(r.get("かな")), gomi_kind(r["収集区分"]), re.sub(r"\s*\n\s*", " ", s(r.get("排出条件/ルール")))]
        for r in read_xlsx(url, "オープンデータ")
        if s(r.get("ごみ品名"))
    ]
    return dict(
        title="ごみの分別",
        credit="ごみの分別一覧表（50音順）",
        page=page, files=[url],
        columns=[["品名", "text"], ["読み", "hidden"], ["出し方", "text"], ["注意", "long"]],
        filters=["出し方"], search=["品名", "読み", "注意"],
        # 絞り込みは決まった区分から選び、含むかどうかで見る
        filterOptions={"出し方": GOMI_KINDS},
        rows=rows,
    )


def aed():
    page = f"{SITE}/0000010080.html"
    u1, u2 = file_url(page, r"AED_koukyou.*\.csv$"), file_url(page, r"AED_convenience.*\.csv$")
    rows = [
        [s(r["施設名称"]), "公共施設", s(r["名称ふりがな"]), s(r["施設所在地"]), s(r["AED設置位置"]), s(r["AED利用可能時間"]), num(r["緯度"]), num(r["経度"])]
        for r in read_csv(u1)
    ] + [
        [s(r["店舗名称"]), "コンビニ", s(r["名称ふりがな"]), s(r["所在地"]), "", "", num(r["緯度"]), num(r["経度"])]
        for r in read_csv(u2)
    ]
    return dict(
        title="AED の場所",
        credit="自動体外式除細動器（AED）の設置情報 オープンデータ",
        page=page, files=[u1, u2],
        columns=[["名称", "text"], ["種類", "text"], ["読み", "hidden"], ["所在地", "text"], ["設置場所", "text"], ["利用可能時間", "text"], ["緯度", "lat"], ["経度", "lon"]],
        filters=["種類"], search=["名称", "読み", "所在地", "利用可能時間"],
        rows=rows,
    )


PARK_TOOLS = ["ブランコ", "スベリ台", "低鉄棒", "シーソー", "ジャングルジム", "複合遊具", "砂場", "ラダー", "健康遊具", "ﾌﾟﾚｲｽｶﾙﾌﾟﾁｬｰ"]


def park():
    page = f"{SITE}/0000004691.html"
    url = file_url(page, r"toshikouen.*\.csv$")
    rows = []
    for r in read_csv(url):
        have = []
        for t in PARK_TOOLS:
            n = sum(num(v) or 0 for k, v in r.items() if k.startswith(t))
            if n:
                have.append(("動物遊具" if t.startswith("ﾌﾟﾚｲ") else t) + (f"×{int(n)}" if n > 1 else ""))
        flag = lambda k: "有" if s(r.get(k)) else ""
        rows.append([
            s(r["公園名称"]), s(r["所在地"]), round(num(r["面積（㎡）"]) or 0), "、".join(have),
            flag("便所"), flag("駐車場"), int(num(r.get("桜_合計")) or 0), flag("一時緊急避難地"), flag("景色の良い公園"),
            num(r["緯度"]), num(r["経度"]),
        ])
    return dict(
        title="都市公園",
        credit="都市公園情報",
        page=page, files=[url],
        note="市のデータは 2021年8月時点",
        columns=[["公園名", "text"], ["所在地", "text"], ["面積（㎡）", "num"], ["遊具", "text"], ["トイレ", "flag"], ["駐車場", "flag"], ["桜の本数", "num"], ["一時避難地", "flag"], ["景色が良い", "flag"], ["緯度", "lat"], ["経度", "lon"]],
        filters=["トイレ", "駐車場", "一時避難地", "景色が良い"], search=["公園名", "所在地", "遊具"],
        sort=["面積（㎡）", "desc"],
        rows=rows,
    )


def toilet():
    page = f"{SITE}/0000023432.html"
    url = file_url(page, r"public_toilet.*\.csv$")
    yn = lambda v: "有" if s(v) == "有" else ""
    rows = []
    for r in read_csv(url):
        t1, t2 = s(r.get("利用開始時間")), s(r.get("利用終了時間"))
        rows.append([
            s(r["名称"]), s(r["住所"]), s(r.get("設置位置")),
            yn(r.get("車椅子使用者用トイレ有無")), yn(r.get("乳幼児用設備設置トイレ有無")), yn(r.get("おむつ替え台")), yn(r.get("オストメイト設置トイレ有無")),
            f"{t1}〜{t2}" if t1 or t2 else "", s(r.get("利用可能時間特記事項")).replace(";", "、"),
            num(r["緯度"]), num(r["経度"]),
        ])
    return dict(
        title="公衆トイレ",
        credit="公衆トイレ一覧",
        page=page, files=[url],
        note="市のデータは 2022年3月時点",
        columns=[["名称", "text"], ["住所", "text"], ["設置場所", "text"], ["車椅子", "flag"], ["乳幼児", "flag"], ["おむつ替え", "flag"], ["オストメイト", "flag"], ["利用時間", "text"], ["休業日・備考", "text"], ["緯度", "lat"], ["経度", "lon"]],
        filters=["車椅子", "乳幼児", "おむつ替え", "オストメイト"], search=["名称", "住所", "設置場所"],
        rows=rows,
    )


def hinanjo():
    page = f"{SITE}/0000036168.html"
    url = file_url(page, r"\.csv$")
    rows = []
    for r in read_csv(url):
        # この CSV の「X座標」は東西、「Y座標」は南北（測量の X・Y と逆）。第VI系とみられる
        lat, lon = plane_to_latlon(num(r["Y座標"]), num(r["X座標"]))
        rows.append([s(r["施設名称"]), s(r["避難所種類"]), s(r["施設ふりがな"]), s(r["住所"]), s(r["電話番号"]), lat, lon])
    return dict(
        title="避難所",
        credit="避難所情報",
        page=page, files=[url],
        note="市のデータは 2022年4月時点。避難所は変わることがあるので、いざというときは市の防災のページ（防災ガイド）で確かめてください。地図の位置は、市のデータの座標（平面直角座標）を緯度・経度に直したもの",
        columns=[["施設名", "text"], ["種類", "text"], ["読み", "hidden"], ["住所", "text"], ["電話", "text"], ["緯度", "lat"], ["経度", "lon"]],
        filters=["種類"], search=["施設名", "読み", "住所"],
        rows=rows,
    )


def kosodate():
    page = f"{SITE}/0000047660.html"
    url = file_url(page, r"preschool.*\.xlsx$")
    rows = [
        [s(r["名称"]), s(r["名称_カナ"]), s(r["種別"]), s(r["住所"]).replace("大阪府枚方市", ""), s(r.get("アクセス方法")), s(r.get("電話番号")), num(r["緯度"]), num(r["経度"])]
        for r in read_xlsx(url, "子育て施設一覧")
        # 住所が「非公開」の行は個人のベビーシッターで、名称に個人の氏名が入っている。載せない
        if s(r.get("名称")) and s(r.get("住所")) != "非公開"
    ]
    return dict(
        title="子育て施設",
        credit="子育て施設一覧",
        page=page, files=[url],
        note="市のデータは 2023年1月時点。住所が非公開の個人のベビーシッター（認可外保育所）は載せていない",
        columns=[["名称", "text"], ["読み", "hidden"], ["種別", "text"], ["住所", "text"], ["アクセス", "text"], ["電話", "text"], ["緯度", "lat"], ["経度", "lon"]],
        filters=["種別"], search=["名称", "読み", "住所", "アクセス"],
        rows=rows,
    )


ERA = {"明治": 1867, "大正": 1911, "昭和": 1925, "平成": 1988, "令和": 2018}


def seireki(v):
    m = re.match(r"(明治|大正|昭和|平成|令和)(元|\d+)", s(v))
    if not m:
        m2 = re.match(r"(\d{4})", s(v))
        return int(m2.group(1)) if m2 else None
    return ERA[m.group(1)] + (1 if m.group(2) == "元" else int(m.group(2)))


def shisetsu():
    page = f"{SITE}/0000023332.html"
    url = file_url(page, r"shisetsu.*\.csv$")
    rows = []
    for r in read_csv(url):
        y = seireki(r.get("設置年"))
        t1, t2 = s(r.get("開館時間")), s(r.get("終了時間"))
        bf = [k for k, label in [("車椅子用エレベーター", "エレベーター"), ("施設玄関口スロープ", "スロープ"), ("身障者用トイレ", "多目的トイレ"), ("自動ドア", "自動ドア")] if s(r.get(k)) and s(r.get(k)) not in ("未設置", "無", "なし", "-")]
        rows.append([
            s(r["施設名"]), s(r.get("施設名（カナ）")), s(r["大分類"]), s(r["中分類"]), s(r["所在(住所)"]).replace("枚方市", ""),
            y, s(r.get("設置年")), f"{t1}〜{t2}" if t1 or t2 else "", s(r.get("定休日")),
            "、".join({"車椅子用エレベーター": "エレベーター", "施設玄関口スロープ": "スロープ", "身障者用トイレ": "多目的トイレ", "自動ドア": "自動ドア"}[k] for k in bf),
        ])
    return dict(
        title="公共施設",
        credit="【オープンデータ】枚方市公共施設一覧",
        page=page, files=[url],
        columns=[["施設名", "text"], ["読み", "hidden"], ["分類", "text"], ["小分類", "text"], ["住所", "text"], ["設置年", "num"], ["設置年（元の表記）", "hidden"], ["利用時間", "text"], ["休館日", "text"], ["バリアフリー", "text"]],
        filters=["分類"], search=["施設名", "読み", "小分類", "住所"],
        sort=["設置年", "asc"],
        rows=rows,
    )


# 枚方市のだいたいの範囲（少し広め）
BBOX = (34.74, 34.91, 135.58, 135.77)


def check_geo(d):
    """緯度と経度が逆の行は入れ替える。市の外を指す座標は地図に出さない（表には残す）。直したものを返す"""
    cols = [c[1] for c in d["columns"]]
    if "lat" not in cols:
        return []
    la, lo = cols.index("lat"), cols.index("lon")
    inside = lambda a, b: BBOX[0] < a < BBOX[1] and BBOX[2] < b < BBOX[3]
    fixed = []
    for r in d["rows"]:
        a, b = r[la], r[lo]
        if a is None or b is None:
            continue
        if not inside(a, b) and inside(b, a):
            r[la], r[lo] = b, a
            fixed.append(f"{r[0]}：緯度と経度が逆だったので入れ替えた")
        elif not inside(a, b):
            r[la] = r[lo] = None
            fixed.append(f"{r[0]}：座標が市の外（{a}, {b}）を指していたので地図に出さない")
    return fixed


DATASETS = {"gomi": gomi, "aed": aed, "park": park, "toilet": toilet, "hinanjo": hinanjo, "kosodate": kosodate, "shisetsu": shisetsu}

if __name__ == "__main__":
    want = sys.argv[1:] or list(DATASETS)
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads(META.read_text()) if META.exists() else {"_source": "", "datasets": {}}
    meta["_source"] = "枚方市のオープンデータ（CC BY 2.1 JP、https://www.city.hirakata.osaka.jp/0000017270.html）。scripts/opendata-data.py で取ってきた"
    today = date.today().isoformat()
    for k in want:
        d = DATASETS[k]()
        d["geoFixed"] = check_geo(d)
        for f in d["geoFixed"]:
            print(f"  ! {k} {f}")
        d.update(id=k, fetched=today, license="CC BY 2.1 JP", licenseUrl="https://creativecommons.org/licenses/by/2.1/jp/")
        (OUT / f"{k}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
        meta["datasets"][k] = {x: d[x] for x in d if x != "rows"} | {"count": len(d["rows"])}
        print(f"✓ {k}: {len(d['rows'])} 行")
        time.sleep(1)
    # 並びは DATASETS の順
    meta["datasets"] = {k: meta["datasets"][k] for k in DATASETS if k in meta["datasets"]}
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
