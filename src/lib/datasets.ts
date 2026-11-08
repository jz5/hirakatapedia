/**
 * データのページ（/data/<id>/）ごとの説明と関連リンク。
 * ごみ（gomi）は専用のページ（src/pages/data/gomi.astro）。ほかは src/pages/data/[id].astro。
 *
 * データの出どころは 2 つ。どちらも、表のデータは public/opendata/<id>.json（列 columns・行 rows・絞り込み filters・検索 search）
 *   - 市のオープンデータ：content/data/opendata.json（scripts/opendata-data.py が作る。手で直さない）
 *   - そのほか（市内のチェーン店の数など、このサイトで調べてまとめたもの）：content/data/datasets-other.json に手で書く。
 *     出典は creditHtml に書く（例：「各社の店舗検索で数えた（2026年11月調べ）」と、店舗検索のページへのリンク）。
 *     group: "other" にすると、データの入口で「そのほかのデータ」に並ぶ
 * どちらも、下の PAGES に説明（lead）と関連リンクを足す
 */
import meta from "../../content/data/opendata.json";
import other from "../../content/data/datasets-other.json";

export interface Link {
  title: string;
  url: string;
  note?: string;
}

export interface DatasetPage {
  /** 一覧のカードと、ページの冒頭に出す 1 文 */
  lead: string;
  /**
   * 「こんなことが分かる」の例。ボタンを押すと、q で検索するか、sort の列で並べ替える（desc なら多い順・新しい順）
   */
  examples?: { label: string; q?: string; sort?: [string, "asc" | "desc"] }[];
  /** 関連リンク（市の案内・同じことができるほかのサイト） */
  links: Link[];
  /** 表の下に置くグラフ（src/lib/chart-defs.mjs の名前）。記事にないもの */
  charts?: string[];
}

const C = "https://www.city.hirakata.osaka.jp/";

export const PAGES: Record<string, DatasetPage> = {
  gomi: {
    lead: "「これは何ごみ？」を品名で調べられます。1,700 あまりの品目の、出し方と注意。",
    links: [],
  },
  aed: {
    lead: "AED（自動体外式除細動器）を置いている市の施設とコンビニ。地図で近くを探せます。",
    examples: [{ label: "24時間利用可能", q: "24時間" }],
    links: [
      { title: "財団全国AEDマップ", url: "https://www.qqzaidanmap.jp/", note: "日本救急医療財団。市の施設とコンビニ以外（会社・マンションなど）の AED も載っている。スマートフォンのアプリ「QQ・MAP」もある" },
      { title: "AED の設置情報（枚方市）", url: `${C}0000010080.html`, note: "このページのもとのデータ" },
    ],
  },
  park: {
    lead: "市の都市公園 200 か所。広さ、遊具、トイレ、駐車場、桜の本数で探せます。",
    examples: [
      { label: "桜の多い順", sort: ["桜の本数", "desc"] },
      { label: "面積の広い順", sort: ["面積（㎡）", "desc"] },
      { label: "ブランコのある公園", q: "ブランコ" },
    ],
    charts: ["data-park-sakura"],
    links: [{ title: "都市公園情報（枚方市）", url: `${C}0000004691.html`, note: "このページのもとのデータ" }],
  },
  toilet: {
    lead: "市の公衆トイレ 171 か所。車椅子用・乳幼児用・おむつ替え・オストメイトの有無で探せます。",
    links: [{ title: "公衆トイレ一覧（枚方市）", url: `${C}0000023432.html`, note: "このページのもとのデータ" }],
  },
  hinanjo: {
    lead: "災害のときの避難所 72 か所（小学校・中学校など）。",
    links: [
      { title: "防災ガイド（ハザードマップ）（枚方市）", url: `${C}0000017941.html`, note: "避難所と、浸水・土砂災害の危ないところの地図。いざというときはこちらを" },
      { title: "重ねるハザードマップ", url: "https://disaportal.gsi.go.jp/", note: "国土交通省・国土地理院。洪水・土砂災害などの危ないところを地図に重ねて見られる" },
      { title: "避難所情報（枚方市）", url: `${C}0000036168.html`, note: "このページのもとのデータ" },
    ],
  },
  kosodate: {
    lead: "保育所・幼稚園・こども園・放課後児童クラブなど。種別で絞り込めます。",
    links: [
      { title: "子育て施設一覧（枚方市）", url: `${C}0000047660.html`, note: "このページのもとのデータ" },
      { title: "ひら☆はぐ（子育て応援アプリ）", url: `${C}0000016649.html`, note: "枚方市の子育てアプリ" },
    ],
  },
  shisetsu: {
    lead: "市の公共施設 263 か所。設置された年の順に並べると、市の施設がいつごろ設置されたかが分かります。",
    examples: [
      { label: "設置年の古い順", sort: ["設置年", "asc"] },
      { label: "設置年の新しい順", sort: ["設置年", "desc"] },
    ],
    charts: ["data-shisetsu-decade"],
    links: [{ title: "枚方市公共施設一覧（枚方市）", url: `${C}0000023332.html`, note: "このページのもとのデータ" }],
  },
};

export type Meta = {
  id: string;
  title: string;
  credit: string;
  page: string;
  note?: string;
  fetched: string;
  count: number;
  files: string[];
  geoFixed?: string[];
  columns: [string, string][];
  search: string[];
  /** 出典の文（HTML）。無ければ市のオープンデータの表示（CC BY 2.1 の表示例 (2) の形） */
  creditHtml?: string;
  /** city：市のオープンデータ、other：そのほか */
  group?: "city" | "other";
};

/** 並び順は、市のデータ（scripts/opendata-data.py の DATASETS の順）のあとに、そのほか */
export const datasets = [
  ...(Object.values(meta.datasets) as unknown as Meta[]).map((d) => ({ ...d, group: "city" as const })),
  ...(Object.values(other.datasets) as unknown as Meta[]).map((d) => ({ ...d, group: "other" as const })),
];
export const dataPath = (id: string) => `/data/${id}/`;
export const hasMap = (d: Meta) => d.columns.some((c) => c[1] === "lat");

export const jaDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};
