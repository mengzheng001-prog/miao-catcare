# CatCare · 宠物医疗档案助手

把宠物的纸质 / PDF 诊疗报告，变成结构化、可追溯、可联动的医疗档案。

- **AI 负责解析，人工负责校对与确权** —— 不自动给诊断，不自动开药
- **本地优先** —— 数据存浏览器 localStorage，不上传任何后端
- **多宠物支持** —— 一份档案管多只猫狗

---

## 功能

- 📄 **PDF 智能解析**：文本型 PDF 走 PDF.js + DeepSeek 结构化；扫描件走豆包视觉
- 📊 **指标趋势图**：血常规 / 生化 / 血气 / 尿检 / 传染病 / B 超 / 心超 / 其他 8 个分类，按英文 code 自动合并同类项
- 💊 **医嘱与提醒**：用药建议 + 复诊计划，按时间倒序，支持手动编辑（OCR 识别不准时改）
- 🐾 **宠物档案**：基础信息 + 体重折线图 + 驱虫记录 + 健康背景
- 🗂️ **健康时间线 / 复诊摘要**：自动汇总每次就诊的结构化结果

---

## 一键启动

需要先装 [Node.js 18+](https://nodejs.org/)（推荐 LTS）。Windows 用户在 Git Bash 或 WSL 中执行下面命令。

```bash
git clone https://github.com/<你的用户名>/miao-catcare.git
cd miao-catcare

./setup.sh   # 装依赖、交互式填 API key、构建前端
./start.sh   # 启动服务
```

浏览器打开 [http://localhost:3001](http://localhost:3001) 即可使用。

---

## API Key 申请

至少配置一个，否则只能看 UI，无法解析真实 PDF。

| Key | 用途 | 申请入口 |
|---|---|---|
| **DEEPSEEK_API_KEY**（推荐必填） | 把 PDF 文本结构化为指标 / 医嘱 / 复诊建议 | [platform.deepseek.com](https://platform.deepseek.com/) |
| **DOUBAO_API_KEY**（推荐填） | 扫描件 / 图片型 PDF 的多模态识别 | [火山方舟控制台](https://www.volcengine.com/product/doubao) |

填好后直接重启 `./start.sh` 即可生效（环境变量从 `.env.local` 读取）。

---

## 项目结构

```
miao-catcare/
├── src/                    # React 19 + TS 前端
│   ├── pages/              # 路由页面（Dashboard / Profile / Reports / Trends ...）
│   ├── lib/                # 数据层（store / pdfParser / indicatorCategories）
│   └── components/         # UI 组件
├── server/                 # Express + tsx 后端
│   ├── index.ts            # API 入口
│   └── services/           # parser-router / deepseek / doubao-vision / ocr-client
├── python_ocr_service/     # PaddleOCR Python 服务（可选 · 高阶用户）
├── setup.sh / start.sh     # 一键脚本
└── .env.example            # 环境变量模板
```

---

## 扫描件 PDF 增强（可选）

默认配置下，扫描件 PDF 会直接走 Doubao 视觉模型识别（足够多数场景）。

如果你想用本地 PaddleOCR 进一步提升识别率（更适合中文医院的扫描件），需要单独搭一个 Python 服务：

```bash
cd python_ocr_service
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
OCR_MODE=real OCR_MAX_PAGES=20 OCR_SERVICE_PORT=5005 python app.py
```

然后把项目根目录的 `.env.local` 中 `OCR_MODE=stub` 改成 `OCR_MODE=real`，重启 Node 服务即可。

> PaddleOCR 模型首次下载较大（~200 MB），中国大陆用户可能需要科学上网或换源。

---

## 技术栈

- **前端**：React 19 + TypeScript + Vite 6 + Tailwind + Recharts
- **后端**：Express + tsx + Multer + PDFKit
- **AI**：DeepSeek（文本结构化）+ Doubao Vision（视觉兜底）+ PaddleOCR（可选 OCR）
- **存储**：浏览器 localStorage（前端零后端 DB）

---

## 隐私 & 安全

- 所有宠物 / 医疗数据 **仅存浏览器 localStorage**，不上传任何服务器
- API Key 仅存本地 `.env.local`（已在 `.gitignore` 排除）
- PDF 文件在浏览器内解析后丢弃，不持久化原文
- 不提供任何 AI 诊断 / 用药建议；所有结构化结果都需要用户在「PDF 结构化结果确认」页面人工校对后入库

---

## License

MIT
