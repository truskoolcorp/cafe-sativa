#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this from inside your git repo."
  exit 1
fi

PATCH_DIR=".chatgpt-patch"
PATCH_FILE="${PATCH_DIR}/patch.sh"

if [ ! -f "$PATCH_FILE" ]; then
  echo "Error: ${PATCH_FILE} not found."
  echo "Create .chatgpt-patch/patch.sh first."
  exit 1
fi

BRANCH_NAME="${1:-chatgpt/patch-$(date +%Y%m%d-%H%M%S)}"
COMMIT_MSG="${COMMIT_MSG:-Apply ChatGPT patch}"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Current branch: ${CURRENT_BRANCH}"
echo "Creating patch branch: ${BRANCH_NAME}"

git checkout -b "$BRANCH_NAME"

chmod +x "$PATCH_FILE"
bash "$PATCH_FILE"

if [ -n "$(git status --porcelain)" ]; then
  git add .
  git commit -m "$COMMIT_MSG"
  git push -u origin "$BRANCH_NAME"
  echo
  echo "Patch applied and pushed."
  echo "Branch: $BRANCH_NAME"
  echo "Open a PR or merge to main when ready."
else
  echo "No file changes detected. Nothing to commit."
fi
