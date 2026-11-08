import { parse } from "yaml";
import snsRaw from "../../content/data/sns.yaml?raw";

/** content/data/sns.yaml（ビルドのときに読む） */
export const readSns = <T>(): T => parse(snsRaw) as T;

/** SNS の種類と、画面に出す名前。並び順もこの順 */
export const SNS_TYPES = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  line: "LINE",
  tiktok: "TikTok",
  threads: "Threads",
  bluesky: "Bluesky",
  note: "note",
  blog: "ブログ",
  site: "サイト",
  app: "アプリ",
  mail: "メール配信",
} as const;
export type SnsType = keyof typeof SNS_TYPES;

export interface Account {
  type: SnsType;
  url: string;
  /** @hirakata_city など。なければ URL から作らない */
  handle?: string;
  /** 「2023年以降投稿なし」など */
  note?: string;
}

export interface SnsItem {
  name: string;
  /** 運営している人・組織 */
  operator?: string;
  /** 何を発信しているか（1 行） */
  about?: string;
  accounts: Account[];
  /** 運営者が自分のサイトでこのアカウントを載せているページ（本人のものだと確かめた根拠） */
  source?: string;
  note?: string;
}

export interface SnsGroup {
  id: string;
  title: string;
  lead?: string;
  items: SnsItem[];
}

export interface Giin {
  name: string;
  kana: string;
  kaiha: string;
  /** 市議会のサイトの議員のページ */
  profile?: string;
  accounts: Account[];
  note?: string;
}

export interface SnsData {
  checked: string;
  groups: SnsGroup[];
  giin: {
    source: string;
    sourceTitle: string;
    checked: string;
    teisu: number;
    note?: string;
    members: Giin[];
  };
  /** 府議会・国会。groups と同じ形 */
  politics: SnsGroup[];
}

/** 表に並べる順。type の一覧の順に並べ替える */
const order = Object.keys(SNS_TYPES);
export const sortAccounts = (a: Account[]) => [...a].sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type));
