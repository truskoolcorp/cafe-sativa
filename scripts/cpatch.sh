#!/usr/bin/env bash
set -euo pipefail

echo "📦 Applying ChatGPT patch..."

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

git fetch origin
git checkout main
git reset --hard origin/main

TMP_FILE=$(mktemp)
cat > "$TMP_FILE"

BRANCH="chatgpt/patch-$(date +%Y%m%d-%H%M%S)"
echo "🌿 Creating branch: $BRANCH"
git checkout -b "$BRANCH"

bash "$TMP_FILE"
rm "$TMP_FILE"

git add .
git commit -m "Apply ChatGPT zero-touch patch"
git push -u origin "$BRANCH"

echo ""
echo "✅ Patch applied and pushed from fresh origin/main."
echo "Previous branch was: $CURRENT_BRANCH"
echo "🔗 Open PR or merge to main."
