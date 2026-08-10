#!/usr/bin/env bash
set -e

HOOK_SRC="$(dirname "$0")/pre-commit"
HOOK_DST=".git/hooks/pre-commit"

mkdir -p .git/hooks

if [ -L "$HOOK_DST" ] || [ -f "$HOOK_DST" ]; then
  echo "pre-commit hook 已存在，跳过安装。"
  exit 0
fi

ln -sf "../../scripts/pre-commit" "$HOOK_DST"
chmod +x "$HOOK_SRC"
echo "pre-commit hook 安装完成。"
