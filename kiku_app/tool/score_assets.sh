#!/bin/sh
# Rebuilds assets/score/engrave.js from the web app's lib/engrave.ts and copies
# abcjs, so the app's score view lays out SheetSage2 scores exactly like the web.
# Run from kiku_app/ after `npm ci` in outputs/kiku-ai.
set -e
web=../outputs/kiku-ai
tmp=$(mktemp -d)
(cd "$web" && npx tsc lib/engrave.ts --target ES2019 --module none --outDir "$tmp" >/dev/null || true)
{
  echo "// Generated from outputs/kiku-ai/lib/engrave.ts by kiku_app/tool/score_assets.sh; edit the TypeScript, not this file."
  echo "(function(){var exports={};"
  cat "$tmp/engrave.js"
  echo "window.kikuEngrave=exports.engrave;})();"
} > assets/score/engrave.js
cp "$web/node_modules/abcjs/dist/abcjs-basic-min.js" assets/score/
cp "$web/node_modules/abcjs/LICENSE.md" assets/score/LICENSE.abcjs.md
rm -rf "$tmp"
