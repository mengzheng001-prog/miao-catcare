# CatCare OCR Skeleton

当前目录提供一个本地 Python OCR service skeleton，用于打通：

PDF 上传
→ Node parse job
→ OCR rawText
→ DeepSeek
→ ReportConfirm

当前阶段：

- 默认 `OCR_MODE=stub`
- 保留 `ocr_stub` 模拟文本
- 可选启用 `OCR_MODE=real` 做最小真实 OCR rawText 验证
- 本仓库不会自动安装 PaddleOCR / PaddlePaddle
- 所有结果仍需进入 `ReportConfirm` 人工确认

## 启动方式

```bash
cd python_ocr_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

默认环境变量：

```bash
export OCR_MODE=stub
export OCR_MAX_PAGES=1
```

默认监听：

- `http://localhost:5005/health`
- `http://localhost:5005/ocr/extract`

## 可选真实 OCR 依赖

如果要启用 `OCR_MODE=real`，请在单独虚拟环境中手动安装：

```bash
pip install -r requirements.txt
pip install -r requirements-ocr.txt
```

说明：

- `requirements.txt` 只包含 skeleton 基础依赖
- `requirements-ocr.txt` 才包含 `paddleocr / paddlepaddle`
- 如果真实 OCR 依赖未安装或环境不兼容，service 会返回受控错误，Node 后端继续 fallback

## 接口

### `GET /health`

返回：

```json
{
  "ok": true,
  "service": "catcare-ocr-skeleton",
  "mode": "stub"
}
```

### `POST /ocr/extract`

输入：

- `multipart/form-data`
- `file`: PDF 文件

返回：

```json
{
  "ok": true,
  "sourceType": "ocr_stub",
  "rawText": "...",
  "pages": [
    {
      "page": 1,
      "text": "..."
    }
  ],
  "meta": {
    "provider": "ocr_stub",
    "mode": "stub",
    "pageCount": 1,
    "processedPages": 1,
    "rawTextChars": 123,
    "needsManualReview": true,
    "warnings": [
      "当前为 OCR skeleton 返回的模拟文本，尚未接入真实 OCR。"
    ]
  }
}
```

## 说明

- `pdf_render.py` 通过 PyMuPDF 渲染前 `N` 页，默认 `OCR_MAX_PAGES=1`
- `OCR_MODE=real` 当前只用于“单页 / 少量页面 rawText 验证”，不是完整生产级 OCR
- 当前不要把 `rawText` 全量写入日志
- 当前不要把 skeleton 文本说成真实 OCR 结果
- 即使真实 OCR 成功，后续也必须进入 `ReportConfirm` 人工确认
