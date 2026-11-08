/**
 * 記事に置くグラフの定義。Markdown の `<div data-chart="名前"></div>` の名前と対応する。
 * データは content/data/ の JSON（出典は JSON の _source）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineChart, barChart, pyramidChart } from "./charts.mjs";

const data = (name) => JSON.parse(readFileSync(join(process.cwd(), "content/data", name), "utf8"));
/** データのページの表のデータ（public/opendata/<id>.json。scripts/opendata-data.py が作る） */
const opendata = (id) => JSON.parse(readFileSync(join(process.cwd(), "public/opendata", `${id}.json`), "utf8"));
const col = (d, name) => d.columns.findIndex((c) => c[0] === name);

/** 人の数の目盛り。10万 / 20万 … */
const man = (n) => (n === 0 ? "0" : `${n / 10000}万`);

export const charts = {
  /** 年齢ごとの人口（人口ピラミッド）。住民基本台帳の月ごとの表 */
  "data-age-pyramid": () => {
    const d = data("age.json");
    const [y, mo] = d.date.split("-").map(Number);
    const pct = (n) => ((n / d.total) * 100).toFixed(1);
    const top = [...d.bands].sort((a, b) => b.male + b.female - (a.male + a.female)).slice(0, 2);
    return pyramidChart({
      id: "chart-data-age",
      title: `枚方市の年齢ごとの人口（${y}年${mo}月1日）`,
      desc: `5歳ごとの男女の人口。いちばん多いのは${top[0].label}（${(top[0].male + top[0].female).toLocaleString("ja-JP")}人）、次が${top[1].label}。65歳以上は${d.groups["65+"].toLocaleString("ja-JP")}人で${pct(d.groups["65+"])}%、15歳未満は${d.groups["0-14"].toLocaleString("ja-JP")}人で${pct(d.groups["0-14"])}%。`,
      leftName: "男性",
      rightName: "女性",
      unit: "人",
      ticks: [0, 5000, 10000, 15000],
      format: (n) => (n === 0 ? "0" : `${n / 10000}万`),
      rows: d.bands.map((b) => ({ label: b.label.replace("100歳以上", "100歳〜"), left: b.male, right: b.female })),
      table: {
        head: ["年齢", "男性", "女性", "計"],
        rows: d.bands.map((b) => [b.label, b.male, b.female, b.male + b.female]),
      },
    });
  },

  /** 市の公共施設が設置された年（10年ごと）。市のオープンデータ「公共施設一覧」 */
  "data-shisetsu-decade": () => {
    const d = opendata("shisetsu");
    const yi = col(d, "設置年");
    const years = d.rows.map((r) => r[yi]).filter(Boolean);
    const buckets = [
      { label: "1949年まで", test: (y) => y < 1950 },
      ...[1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map((dec) => ({ label: `${dec}年代`, test: (y) => y >= dec && y < dec + 10 })),
    ];
    const rows = buckets.map((b) => ({ label: b.label, value: years.filter(b.test).length, kind: "hl" }));
    const n7080 = years.filter((y) => y >= 1970 && y < 1990).length;
    return barChart({
      id: "chart-data-shisetsu",
      title: "市の公共施設が設置された年（10年ごと）",
      desc: `市の公共施設${years.length}か所のうち、${n7080}か所（${Math.round((n7080 / years.length) * 100)}%）が1970年代と1980年代に設置された。人口が急に増えた時期（1960年代の終わりから1970年代）と重なる。`,
      format: (n) => `${n}か所`,
      rows,
      table: { head: ["設置年", "施設数"], rows: rows.map((r) => [r.label, r.value]) },
    });
  },

  /** 桜の多い公園（上位10）。市のオープンデータ「都市公園情報」 */
  "data-park-sakura": () => {
    const d = opendata("park");
    const si = col(d, "桜の本数");
    const top = [...d.rows].sort((a, b) => b[si] - a[si]).slice(0, 10);
    const all = d.rows.reduce((a, r) => a + r[si], 0);
    return barChart({
      id: "chart-data-sakura",
      title: "桜の多い市の公園（上位10）",
      desc: `市の都市公園${d.rows.length}か所の桜は合わせて${all.toLocaleString("ja-JP")}本。いちばん多いのは${top[0][0]}の${top[0][si]}本で、2番目の${top[1][0]}（${top[1][si]}本）の4倍以上。`,
      format: (n) => `${n}本`,
      rows: top.map((r) => ({ label: r[0].replace(/（.*）/, ""), value: r[si], kind: "hl" })),
      table: { head: ["公園名", "桜の本数"], rows: top.map((r) => [r[0], r[si]]) },
    });
  },

  /** 枚方市の人口の移り変わり（1947〜2025年）と、市の推計（〜2053年） */
  "jinko-population": () => {
    const d = data("jinko.json");
    const actual = d.annual.map((a) => [a.year, a.total]);
    const census = d.census.map((c) => [c.year, c.population]);
    const proj = d.projection.map((p) => [p.year, p.population]);
    const years = [...new Set([...actual, ...census, ...proj].map((p) => p[0]))].sort((a, b) => a - b);
    const at = (list, y) => list.find((p) => p[0] === y)?.[1] ?? "";
    return lineChart({
      id: "chart-jinko-population",
      title: "枚方市の人口（1947〜2025年）と、市の推計（2053年まで）",
      desc:
        "1947年の約4万2千人から、1958年ごろを境に急に増え、1969年には1年で2万8千人増えた。1995年に40万人を超え、2009年末の41万1777人がいちばん多い。そのあと減り続け、2025年末は39万926人。市の推計では2053年に約30万6千人。",
      x: { min: 1945, max: 2056, ticks: [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030, 2040, 2050] },
      y: { min: 0, max: 480000, ticks: [0, 100000, 200000, 300000, 400000], format: man },
      unit: "人",
      series: [
        { name: "住民基本台帳（年末）", color: 1, points: actual },
        { name: "国勢調査（10月1日）", color: 2, points: census, line: false, dots: true },
        { name: "市の推計（ケース4）", color: "mut", points: proj, dashed: true },
      ],
      refLines: [{ y: 400000, label: "40万人" }],
      notes: [
        { x: 1958, y: at(actual, 1958), text: "1958年\n香里団地に入居", dx: 56, dy: 44, anchor: "start" },
        { x: 1969, y: at(actual, 1969), text: "1969年\n1年で2万8千人増", dx: -54, dy: -40, anchor: "middle" },
        { x: 2009, y: at(actual, 2009), text: "2009年末 41万1777人", dx: -14, dy: -30, anchor: "end" },
        { x: 1955, y: at(actual, 1955), text: "1955年\n津田町と合併", dx: -4, dy: -56, anchor: "middle" },
      ],
      table: {
        head: ["年", "住民基本台帳（年末）", "国勢調査（10月1日）", "市の推計"],
        rows: years.map((y) => [`${y}年`, at(actual, y), at(census, y), at(proj, y)]),
      },
    });
  },

  /** 1年に生まれた人と亡くなった人（1999〜2025年） */
  "jinko-births-deaths": () => {
    const d = data("jinko.json");
    const births = d.vital.map((v) => [v.year, v.births]);
    const deaths = d.vital.map((v) => [v.year, v.deaths]);
    const last = d.vital[d.vital.length - 1];
    const cross = d.vital.find((v) => v.deaths > v.births);
    return lineChart({
      id: "chart-jinko-births-deaths",
      title: "1年に生まれた人と亡くなった人（1999〜2025年）",
      desc: `1999年は生まれた人が${births[0][1].toLocaleString("ja-JP")}人、亡くなった人が${deaths[0][1].toLocaleString("ja-JP")}人。${cross.year}年に亡くなった人のほうが多くなり、${last.year}年は生まれた人${last.births.toLocaleString("ja-JP")}人、亡くなった人${last.deaths.toLocaleString("ja-JP")}人。`,
      x: { min: 1998, max: 2030, ticks: [2000, 2005, 2010, 2015, 2020, 2025] },
      y: { min: 0, max: 5000, ticks: [0, 1000, 2000, 3000, 4000, 5000], format: (n) => n.toLocaleString("ja-JP") },
      unit: "人",
      series: [
        { name: "生まれた人（出生）", color: 1, points: births, end: "出生" },
        { name: "亡くなった人（死亡）", color: 2, points: deaths, end: "死亡" },
      ],
      notes: [{ x: cross.year, y: cross.deaths, text: `${cross.year}年から\n亡くなる人が多い`, dx: 0, dy: -46, anchor: "middle" }],
      table: {
        head: ["年", "出生", "死亡", "出生 − 死亡"],
        rows: d.vital.map((v) => [`${v.year}年`, v.births, v.deaths, v.births - v.deaths]),
      },
    });
  },

  /** 自然増減（出生−死亡）と社会増減（転入−転出）（1999〜2025年） */
  "jinko-change": () => {
    const d = data("jinko.json");
    const natural = d.vital.map((v) => [v.year, v.natural]);
    const social = d.vital.map((v) => [v.year, v.social]);
    const signed = (n) => (n > 0 ? `+${n.toLocaleString("ja-JP")}` : n < 0 ? `−${(-n).toLocaleString("ja-JP")}` : "0");
    return lineChart({
      id: "chart-jinko-change",
      title: "1年の増減の内わけ：生まれた・亡くなった（自然増減）と、引っ越し（社会増減）",
      desc: "1999〜2012年は、生まれる人が亡くなる人より多い一方、引っ越して出ていく人のほうが多い年が多かった。2013年からは逆に、亡くなる人のほうが多くなり、2025年は2,572人の減少。引っ越しは2020年と2022〜2025年はプラスで、2025年は1,170人の増加。",
      x: { min: 1998, max: 2031, ticks: [2000, 2005, 2010, 2015, 2020, 2025] },
      y: { min: -3000, max: 2000, ticks: [-3000, -2000, -1000, 0, 1000, 2000], format: signed },
      unit: "人",
      series: [
        { name: "自然増減（出生 − 死亡）", color: 1, points: natural, end: "自然増減" },
        { name: "社会増減（転入 − 転出）", color: 2, points: social, end: "社会増減" },
      ],
      refLines: [{ y: 0, label: "" }],
      table: {
        head: ["年", "自然増減", "社会増減", "合計"],
        rows: d.vital.map((v) => [`${v.year}年`, signed(v.natural), signed(v.social), signed(v.natural + v.social)]),
      },
    });
  },

  /** 外国人の人口（1999〜2025年） */
  "jinko-foreign": () => {
    const d = data("jinko.json");
    const f = d.foreign;
    const last = f[f.length - 1];
    return lineChart({
      id: "chart-jinko-foreign",
      title: "枚方市に住む外国人の人数（1999〜2025年、各年末）",
      desc: `1999年は${f[0].total.toLocaleString("ja-JP")}人。2021年まではおおむね4千人台で、2022年から増え、2025年末は${last.total.toLocaleString("ja-JP")}人。`,
      x: { min: 1998, max: 2030, ticks: [2000, 2005, 2010, 2015, 2020, 2025] },
      y: { min: 0, max: 8000, ticks: [0, 2000, 4000, 6000, 8000], format: (n) => n.toLocaleString("ja-JP") },
      unit: "人",
      series: [{ name: "外国人", color: 1, points: f.map((x) => [x.year, x.total]), end: `${last.total.toLocaleString("ja-JP")}人` }],
      table: {
        head: ["年", "総数", "中国", "ベトナム", "韓国・朝鮮"],
        rows: f.map((x) => [`${x.year}年`, x.total, x.china, x.vietnam, x.korea]),
      },
    });
  },

  /** 大阪府内の人口の順位（国勢調査の上位10市、1980〜2025年） */
  "jinko-osaka-rank": () => {
    const d = data("jinko-compare.json");
    const names = Object.keys(d.ranks[d.ranks.length - 1].cities).sort(
      (a, b) => d.ranks[d.ranks.length - 1].cities[a].rank - d.ranks[d.ranks.length - 1].cities[b].rank,
    );
    const series = names.map((n) => ({
      name: n,
      color: n === "枚方市" ? 1 : "mut",
      muted: n !== "枚方市",
      points: d.ranks.map((r) => [r.year, -r.cities[n].rank]),
      end: n,
    }));
    const h = d.ranks.map((r) => `${r.year}年 ${r.cities["枚方市"].rank}位`).join("、");
    return lineChart({
      id: "chart-jinko-osaka-rank",
      title: "大阪府内の人口の順位（国勢調査、上位10市）",
      desc: `枚方市の順位は ${h}。1995年に豊中市を抜いて4位になり、2020年に豊中市、2025年に吹田市に抜かれた。`,
      x: { min: 1978, max: 2033, ticks: [1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025] },
      y: { min: -10.6, max: -0.4, ticks: [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10], format: (n) => `${-n}位` },
      valueText: (n) => `${-n}位`,
      legend: [
        { name: "枚方市", color: 1 },
        { name: "ほかの市", color: "mut" },
      ],
      series,
      table: {
        head: ["年", ...names],
        rows: d.ranks.map((r) => [`${r.year}年`, ...names.map((n) => `${r.cities[n].rank}位（${r.cities[n].population.toLocaleString("ja-JP")}人）`)]),
      },
    });
  },

  /** 外国人の割合（2026年1月1日）。全国・大阪府と、府内の上位10市 */
  "jinko-foreign-share": () => {
    const d = data("jinko-compare.json");
    const cities = [...d.foreignCities].sort((a, b) => b.share - a.share);
    const rows = [
      ...d.foreign.map((f) => ({ label: f.name, value: f.share, kind: "ref" })),
      ...cities.map((c) => ({ label: c.name, value: c.share, kind: c.name === "枚方市" ? "hl" : undefined })),
    ];
    const h = d.foreignCities.find((c) => c.name === "枚方市");
    return barChart({
      id: "chart-jinko-foreign-share",
      title: "人口のうち外国人の割合（2026年1月1日）",
      desc: `枚方市は${h.share}%。全国は${d.foreign[0].share}%、大阪府は${d.foreign[1].share}%。府内の人口の多い10市の中では、高槻市に次いで低い。`,
      rows,
      format: (n) => `${n.toFixed(2)}%`,
      table: {
        head: ["", "人口", "外国人", "割合", "2025年の外国人の増減"],
        rows: [...d.foreign, ...cities].map((c) => [
          c.name,
          c.population,
          c.foreign,
          `${c.share.toFixed(2)}%`,
          `${c.foreignChange > 0 ? "+" : ""}${c.foreignChange.toLocaleString("ja-JP")}人（${c.foreignChangeRate > 0 ? "+" : ""}${c.foreignChangeRate.toFixed(1)}%）`,
        ]),
      },
    });
  },

  /** 枚方市立図書館の1年の貸出冊数（1989〜2025年度） */
  "library-lending": () => {
    const d = data("library.json");
    const pts = d.lending.map((r) => [r.year, r.books]);
    const at = (y) => d.lending.find((r) => r.year === y)?.books;
    const peak = d.lending.reduce((a, r) => (r.books > a.books ? r : a));
    const last = d.lending[d.lending.length - 1];
    return lineChart({
      id: "chart-library-lending",
      title: `枚方市立図書館の1年の貸出冊数（${d.lending[0].year}〜${last.year}年度）`,
      desc: `${d.lending[0].year}年度は約${Math.round(d.lending[0].books / 10000)}万冊。2005年度に中央図書館が開館して増え、${peak.year}年度の${peak.books.toLocaleString("ja-JP")}冊がいちばん多い。2020年度は新型コロナで約${Math.round(at(2020) / 10000)}万冊に減り、${last.year}年度は${last.books.toLocaleString("ja-JP")}冊。`,
      x: { min: 1987, max: 2027, ticks: [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025] },
      y: { min: 0, max: 5000000, ticks: [0, 1000000, 2000000, 3000000, 4000000, 5000000], format: man },
      unit: "冊",
      series: [{ name: "貸出冊数", color: 1, points: pts }],
      notes: [
        { x: 2005, y: at(2005), text: "2005年\n中央図書館が開館", dx: -10, dy: 46, anchor: "end" },
        { x: peak.year, y: peak.books, text: `${peak.year}年度 ${peak.books.toLocaleString("ja-JP")}冊`, dx: -20, dy: -24, anchor: "end" },
        { x: 2020, y: at(2020), text: "2020年度\n新型コロナ", dx: 0, dy: 44, anchor: "middle" },
      ],
      table: { head: ["年度", "貸出冊数"], rows: d.lending.map((r) => [`${r.year}年度`, r.books]) },
    });
  },

  /** 市民1人あたりの貸出冊数。大阪府内の上位10市町村と、府・全国 */
  "library-per-capita": () => {
    const d = data("library.json");
    // perCapita は小数2けたに丸めてあるので、並べ替えと表示は割り算し直した値で
    const per = (c) => c.lending / c.population;
    const ranked = [...d.cities].sort((a, b) => per(b) - per(a));
    const rank = ranked.findIndex((c) => c.name === "枚方市") + 1;
    const rows = [
      ...ranked.slice(0, 10).map((c) => ({ label: c.name, value: per(c), kind: c.name === "枚方市" ? "hl" : undefined })),
      { label: "大阪府", value: per(d.osaka), kind: "ref" },
      { label: "全国", value: d.japan.perCapita, kind: "ref" },
    ];
    return barChart({
      id: "chart-library-per-capita",
      title: "住民1人あたりの貸出冊数（2024年度）：大阪府内の上位10市町村",
      desc: `大阪府内43市町村のうち、枚方市は${rank}位（${per(ranked[rank - 1]).toFixed(1)}冊）。1位は箕面市、2位は茨木市。大阪府全体は${d.osaka.perCapita}冊、全国は${d.japan.perCapita}冊（${d.japan.year}年度）。`,
      rows,
      format: (n) => `${n.toFixed(1)}冊`,
      table: {
        head: ["", "人口（2025年1月1日）", "貸出冊数（2024年度）", "1人あたり"],
        rows: [
          ...ranked.map((c, i) => [`${i + 1}. ${c.name}`, c.population, c.lending, `${per(c).toFixed(2)}冊`]),
          ["大阪府（府立図書館を含む）", d.osaka.population, d.osaka.lending, `${d.osaka.perCapita.toFixed(2)}冊`],
          [`全国（${d.japan.year}年度）`, "", "", `${d.japan.perCapita}冊`],
        ],
      },
    });
  },

  /** 蔵書回転率（1年の貸出 ÷ 蔵書）。大阪府内の上位10市町村 */
  "library-turnover": () => {
    const d = data("library.json");
    const turn = (c) => c.lending / c.books;
    const ranked = d.cities.filter((c) => c.books > 0).sort((a, b) => turn(b) - turn(a));
    return barChart({
      id: "chart-library-turnover",
      title: "蔵書回転率（2024年度）：大阪府内の上位10市町村",
      desc: `1年に貸し出した本の数を、持っている本の数で割った数。枚方市は${turn(ranked[0]).toFixed(2)}回で府内1位。2位は${ranked[1].name}（${turn(ranked[1]).toFixed(2)}回）。`,
      rows: ranked.slice(0, 10).map((c) => ({ label: c.name, value: turn(c), kind: c.name === "枚方市" ? "hl" : undefined })),
      format: (n) => `${n.toFixed(2)}回`,
      table: {
        head: ["", "蔵書冊数", "貸出冊数（2024年度）", "回転率", "表に載っている館の数"],
        rows: ranked.map((c, i) => [`${i + 1}. ${c.name}`, c.books, c.lending, `${turn(c).toFixed(2)}回`, c.halls]),
      },
    });
  },

  /** 猛暑日（最高気温 35℃以上）の日数。枚方・大阪・京都（1994〜2025年） */
  "atsui-mosho": () => heatDays("mosho"),

  /** 最低気温が 25℃以上の日（熱帯夜の目安）の日数。枚方・大阪・京都（1994〜2025年） */
  "atsui-nettaiya": () => heatDays("nettaiya"),
};

/** 暑さの記事の、3地点を比べる折れ線グラフ */
function heatDays(key) {
  const d = data("atsui.json");
  const pts = (n) => d.years.map((r) => [r.year, r[n][key]]);
  const avg = (n) => {
    const last5 = d.years.slice(-5);
    return (last5.reduce((a, r) => a + r[n][key], 0) / 5).toFixed(1);
  };
  const [y0, y1] = [d.years[0].year, d.years[d.years.length - 1].year];
  const mosho = key === "mosho";
  const more = d.years.filter((r) => r.枚方[key] > r.大阪[key]).length;
  return lineChart({
    id: `chart-atsui-${key}`,
    title: mosho
      ? `猛暑日（最高気温 35℃以上）の日数：枚方・大阪・京都（${y0}〜${y1}年）`
      : `最低気温が 25℃以上の日（熱帯夜の目安）の日数：枚方・大阪・京都（${y0}〜${y1}年）`,
    desc: mosho
      ? `${d.years.length}年のうち${more}年は枚方のほうが大阪より猛暑日が多い。${y1 - 4}〜${y1}年の平均は、枚方${avg("枚方")}日、大阪${avg("大阪")}日、京都${avg("京都")}日。`
      : `どの年も、枚方は大阪より少ない。${y1 - 4}〜${y1}年の平均は、枚方${avg("枚方")}日、大阪${avg("大阪")}日、京都${avg("京都")}日。`,
    x: { min: y0 - 1, max: y1 + 1, ticks: [1995, 2000, 2005, 2010, 2015, 2020, 2025] },
    y: { min: 0, max: mosho ? 70 : 90, ticks: mosho ? [0, 10, 20, 30, 40, 50, 60] : [0, 20, 40, 60, 80], format: (n) => `${n}日` },
    unit: "日",
    series: [
      { name: "枚方（アメダス）", color: 1, points: pts("枚方") },
      { name: "大阪（大阪市中央区）", color: 2, points: pts("大阪") },
      { name: "京都（京都市中京区）", color: "mut", points: pts("京都"), dashed: true, muted: true },
    ],
    table: {
      head: ["年", "枚方", "大阪", "京都"],
      rows: d.years.map((r) => [`${r.year}年`, r.枚方[key], r.大阪[key], r.京都[key]]),
    },
  });
}
