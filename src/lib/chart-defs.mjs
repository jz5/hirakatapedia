/**
 * 記事に置くグラフの定義。Markdown の `<div data-chart="名前"></div>` の名前と対応する。
 * データは content/data/ の JSON（出典は JSON の _source）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineChart, barChart } from "./charts.mjs";

const data = (name) => JSON.parse(readFileSync(join(process.cwd(), "content/data", name), "utf8"));

/** 人の数の目盛り。10万 / 20万 … */
const man = (n) => (n === 0 ? "0" : `${n / 10000}万`);

export const charts = {
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
      desc: "1999〜2012年は、生まれる人が亡くなる人より多い一方、引っ越して出ていく人のほうが多かった。2013年からは逆に、亡くなる人のほうが多くなり、2025年は2,572人の減少。引っ越しは2020年と2022〜2025年はプラスで、2025年は1,170人の増加。",
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
};
