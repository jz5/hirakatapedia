/** 対象要素のテキストをクリップボードへコピーするボタンを設定する */
export function bindCopyButton(buttonSelector: string, targetSelector: string) {
  const btn = document.querySelector<HTMLButtonElement>(buttonSelector);
  const target = document.querySelector<HTMLElement>(targetSelector);
  if (!btn || !target) return;
  const initialLabel = btn.textContent ?? "コピー";
  let timer: number | undefined;
  btn.addEventListener("click", async () => {
    window.clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      btn.textContent = "コピーしました";
    } catch {
      btn.textContent = "コピーできませんでした";
    }
    timer = window.setTimeout(() => {
      btn.textContent = initialLabel;
    }, 2500);
  });
}
