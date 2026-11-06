/**
 * 「## まとめ」から次の h2 の手前までを <section class="summary"> で囲む。
 * 記事の Markdown には何も書き足さずに、まとめだけ枠で見せるため。
 */
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
  };
}
