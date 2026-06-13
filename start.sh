#!/usr/bin/env bash
# CatCare 启动脚本：跑 Node 后端（同时 serve 前端 dist）。
# 用法：./start.sh
# 退出：Ctrl+C
# Windows 用户：在 Git Bash 或 WSL 中执行。

set -e

cd "$(dirname "$0")"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()  { echo -e "${BLUE}[info]${RESET} $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET} $*"; }
error() { echo -e "${RED}[error]${RESET} $*"; }

# 依赖检查
if [ ! -d "node_modules" ]; then
  error "未检测到 node_modules。请先运行 ./setup.sh"
  exit 1
fi
if [ ! -f ".env.local" ]; then
  error "未检测到 .env.local。请先运行 ./setup.sh 配置 API key"
  exit 1
fi
if [ ! -d "dist" ]; then
  warn "未检测到 dist/，执行一次 npm run build..."
  npm run build >/dev/null
  ok "构建完成"
fi

# Key 提醒
HAS_DS=$(grep -E "^DEEPSEEK_API_KEY=.+" .env.local | grep -v "=$" || true)
HAS_DB=$(grep -E "^DOUBAO_API_KEY=.+" .env.local | grep -v "=$" || true)
if [ -z "$HAS_DS" ] && [ -z "$HAS_DB" ]; then
  warn "未配置任何 API Key —— 界面可用，但无法解析真实 PDF。"
  warn "如要解析 PDF，请编辑 .env.local 填入 DEEPSEEK_API_KEY 后重启。"
fi

PORT_TO_USE="${PORT:-3001}"
ok "启动服务：http://localhost:${PORT_TO_USE}"
echo ""
echo "  浏览器访问后即可使用。Ctrl+C 退出服务。"
echo ""

NODE_OPTIONS="--max-old-space-size=4096" NODE_ENV=production npm run start
