import type { APIRoute } from "astro";
import { indexMeta } from "../../../lib/gallery-index";

/** 写真ギャラリーの一覧のデータの目録（src/lib/gallery-index.ts） */
export const GET: APIRoute = () => new Response(JSON.stringify(indexMeta()), { headers: { "Content-Type": "application/json; charset=utf-8" } });
