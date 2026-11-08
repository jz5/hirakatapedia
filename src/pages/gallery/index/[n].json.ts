import type { APIRoute, GetStaticPaths } from "astro";
import { indexChunk, indexMeta } from "../../../lib/gallery-index";

/** 写真ギャラリーの一覧のデータ（5,000 枚ずつ。src/lib/gallery-index.ts） */
export const getStaticPaths = (() => Array.from({ length: indexMeta().chunks }, (_, n) => ({ params: { n: String(n) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(indexChunk(Number(params.n))), { headers: { "Content-Type": "application/json; charset=utf-8" } });
