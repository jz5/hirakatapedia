/**
 * 「## まとめ」から次の h2 の手前までを <section class="summary"> で囲む。
 * 記事の Markdown には何も書き足さずに、まとめだけ枠で見せるため。
 *
 * 記事の冒頭は、どの記事も同じ形にする：
 *   1. 「〜と人に話すときに、…説明できるページです」（記事ごとに Markdown に書く）
 *   2. 読み方の案内（ここで入れる。全記事共通の文）
 *   3. まとめ
 * 写真は冒頭に置かず、関係のある節に入れる
 */
const GUIDE = "マーカーを引いたところだけ読めば、だいたい話せます。本文の [1] のような番号は出典で、いちばん下に一覧があります。確かめたい人は、そこから元の資料をたどれます。";
const text = (node) =>
  node.type === "text" ? node.value : (node.children ?? []).map(text).join("");

export default function rehypeSummary() {
  return (tree) => {
    const kids = tree.children;
    const start = kids.findIndex(
      (n) => n.type === "element" && n.tagName === "h2" && text(n).trim() === "まとめ",
    );
    if (start < 0) return;
    let end = kids.findIndex(
      (n, i) => i > start && n.type === "element" && n.tagName === "h2",
    );
    if (end < 0) end = kids.length;
    const section = {
      type: "element",
      tagName: "section",
      properties: { className: ["summary"] },
      children: kids.slice(start, end),
    };
    kids.splice(start, end - start, section);
    kids.splice(start, 0, { type: "element", tagName: "p", properties: { className: ["entry-guide"] }, children: [{ type: "text", value: GUIDE }] });
  };
}
