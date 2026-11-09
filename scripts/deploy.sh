#!/usr/bin/env bash
# 枚方pedia を本番（エックスサーバー）に上げる。
#
#   pnpm run deploy            写真・サムネイルを取ってきて、ビルドして、変わるファイルを見せてから上げる（確認あり）
#   pnpm run deploy --dry-run  上げずに、変わるファイルだけ見せる
#
# 上げる先は .env の DEPLOY_HOST（~/.ssh/config の Host 名）と DEPLOY_PATH（サーバーのフォルダー）。
#   DEPLOY_HOST=your-ssh-host
#   DEPLOY_PATH=/path/to/hirakata.pronama.jp/
# rsync の --delete で、手元に無いファイルはサーバーからも消す。間違ったフォルダーを消さないよう、
# DEPLOY_PATH は「hirakata.pronama.jp/」で終わるものだけ受け付ける。
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done

# .env から読む（無ければ既定）
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
HOST="${DEPLOY_HOST:-$(env_get DEPLOY_HOST)}"
DEST="${DEPLOY_PATH:-$(env_get DEPLOY_PATH)}"
HOST="${HOST:-your-ssh-host}"
DEST="${DEST:-/path/to/hirakata.pronama.jp/}"
case "$DEST" in
  */hirakata.pronama.jp/) ;;
  *) echo "DEPLOY_PATH が hirakata.pronama.jp/ で終わっていない：$DEST" >&2; exit 1 ;;
esac

echo "== 上げる先：$HOST:$DEST"
ssh -n -o BatchMode=yes "$HOST" "test -d '$DEST'" || { echo "サーバーにフォルダーが無い（サブドメインを作ったか確かめる）：$DEST" >&2; exit 1; }

echo "== 写真ギャラリーの画像（まだ無いものだけ取ってくる）"
node scripts/gallery.mjs images
echo "== 関連リンクのカード（サムネイルが無ければ取り直す）"
node scripts/link-cards.mjs
echo "== よく読まれている記事（GA の設定があれば作り直す）"
node scripts/popular.mjs
echo "== ビルド"
pnpm build

# --checksum：ビルドのたびに日時が変わるので、中身で比べる（変わったファイルだけが一覧に出る）
RSYNC=(rsync -az --checksum --delete --human-readable --exclude=".DS_Store" -e ssh)

echo "== 変わるファイル（rsync --dry-run）"
# 一覧を先にファイルへ書き切ってから見る（パイプで head すると、途中で切れる）
LOG=/tmp/hirakatapedia-deploy.txt
"${RSYNC[@]}" --dry-run --itemize-changes dist/ "$HOST:$DEST" > "$LOG"
grep -E '^\*deleting' "$LOG" | head -20 || true
grep -E '^<f' "$LOG" | head -50 || true
echo "（全部は $LOG）"
echo "上げるファイル：$(grep -cE '^<f' "$LOG" || true) 件（新しい $(grep -cE '^<f\+' "$LOG" || true) 件）／サーバーから消すファイル：$(grep -cE '^\*deleting' "$LOG" || true) 件"

if [ "$DRY" = 1 ]; then
  echo "== --dry-run なので上げない"
  exit 0
fi

read -r -p "本番（https://hirakata.pronama.jp/）に上げますか？ [y/N] " ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "やめた"; exit 1; }

echo "== 上げる"
"${RSYNC[@]}" dist/ "$HOST:$DEST"
echo "== 終わり：https://hirakata.pronama.jp/"
