#!/usr/bin/env bash
# CatCare 一键初始化脚本：装依赖 + 填 API key + 构建前端。
# 用法：./setup.sh
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

# ────────────────────────────────────────────
# 1) 环境检查
# ────────────────────────────────────────────
info "检查 Node / npm 是否安装..."
if ! command -v node >/dev/null 2>&1; then
  error "未检测到 node。请先安装 Node 18+（推荐 LTS）：https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node 版本过低（当前 v$(node -v | sed 's/v//')），需要 18+"
  exit 1
fi
ok "Node 版本 $(node -v) ✓"

if ! command -v npm >/dev/null 2>&1; then
  error "未检测到 npm。"
  exit 1
fi
ok "npm 版本 $(npm -v) ✓"

# ────────────────────────────────────────────
# 2) 安装 npm 依赖
# ────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  info "首次运行：执行 npm install（可能需要 1-3 分钟）..."
  npm install
  ok "依赖安装完成"
else
  info "已检测到 node_modules，跳过 npm install（如需重装请删除该目录）"
fi

# ────────────────────────────────────────────
# 3) 生成 .env.local
# ────────────────────────────────────────────
ENV_FILE=".env.local"
if [ -f "$ENV_FILE" ]; then
  warn ".env.local 已存在。"
  read -r -p "    是否覆盖？(y/N) " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    info "保留现有 .env.local，跳过 API key 配置"
    SKIP_ENV=1
  fi
fi

if [ -z "${SKIP_ENV:-}" ]; then
  echo ""
  info "配置 API Key（按 Enter 跳过则该项留空）"
  echo "  · DeepSeek 申请：https://platform.deepseek.com/"
  echo "  · Doubao  申请：https://www.volcengine.com/product/doubao （火山方舟控制台）"
  echo ""

  read -r -p "  DeepSeek API Key（必填，用于结构化 PDF 文本）: " DS_KEY
  read -r -p "  Doubao API Key（可选，扫描件 PDF 用）: " DB_KEY

  DB_MODEL=""
  if [ -n "$DB_KEY" ]; then
    read -r -p "  Doubao Model / 接入点 ID（如 ep-202xxxxx）: " DB_MODEL
  fi

  if [ -z "$DS_KEY" ] && [ -z "$DB_KEY" ]; then
    warn "两个 API Key 都没填。系统将只能展示界面，无法解析真实 PDF。"
  fi

  # 复制模板再覆盖关键字段
  cp .env.example "$ENV_FILE"
  # macOS sed 需要 ''，Linux sed 不需要 —— 用 perl 跨平台
  perl -i -pe "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=${DS_KEY}|" "$ENV_FILE"
  perl -i -pe "s|^DOUBAO_API_KEY=.*|DOUBAO_API_KEY=${DB_KEY}|" "$ENV_FILE"
  perl -i -pe "s|^DOUBAO_MODEL=.*|DOUBAO_MODEL=${DB_MODEL}|" "$ENV_FILE"

  ok ".env.local 已生成"
fi

# ────────────────────────────────────────────
# 4) 构建前端
# ────────────────────────────────────────────
info "构建前端静态文件..."
npm run build >/dev/null
ok "前端构建完成（dist/）"

# ────────────────────────────────────────────
# 5) 完成
# ────────────────────────────────────────────
echo ""
ok "初始化完成 🎉"
echo ""
echo "下一步："
echo "  ./start.sh           # 启动服务"
echo "  浏览器打开 http://localhost:3001"
echo ""
echo "如需修改 API key：编辑 .env.local 后重启服务"
