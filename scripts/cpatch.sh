#!/usr/bin/env bash
set -euo pipefail

echo "📦 Applying ChatGPT patch..."

TMP_FILE=$(mktemp)

# Read patch from stdin
cat > "$TMP_FILE"

# Run it
bash "$TMP_FILE"

rm "$TMP_FILE"

BRANCH="chatgpt/patch-$(date +%Y%m%d-%H%M%S)"

echo "🌿 Creating branch: $BRANCH"
git checkout -b "$BRANCH"

git add .
git commit -m "Apply ChatGPT zero-touch patch"

git push -u origin "$BRANCH"

echo ""
echo "✅ Patch applied and pushed."
echo "🔗 Open PR or merge to main."