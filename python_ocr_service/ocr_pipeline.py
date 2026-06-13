from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
from time import perf_counter
from typing import Any

from pdf_render import extract_pdf_text_pages, get_pdf_page_count, parse_max_pages, render_pdf_pages


OCR_PIPELINE_CACHE_VERSION = "v2_pymupdf_text_paddleocr"
MIN_TEXT_LAYER_CHARS = int(os.environ.get("OCR_MIN_TEXT_LAYER_CHARS", "300"))


def get_result_cache_dir() -> str:
    root = os.environ.get("OCR_CACHE_DIR") or "/tmp/catcare_ocr_cache"
    cache_dir = os.path.join(root, "results")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def compute_file_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


def get_result_cache_path(file_hash: str, max_pages: int) -> str:
    key = f"{OCR_PIPELINE_CACHE_VERSION}_{file_hash}_{max_pages}.json"
    return os.path.join(get_result_cache_dir(), key)


def read_cached_result(file_hash: str, max_pages: int) -> dict[str, Any] | None:
    cache_path = get_result_cache_path(file_hash, max_pages)
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            cached = json.load(handle)
        if not isinstance(cached, dict) or not cached.get("rawText"):
            return None
        meta = cached.setdefault("meta", {})
        meta["cacheHit"] = True
        warnings = meta.setdefault("warnings", [])
        if "命中文件级 OCR 缓存，未重复执行 OCR。" not in warnings:
            warnings.append("命中文件级 OCR 缓存，未重复执行 OCR。")
        return cached
    except Exception:
        return None


def write_cached_result(file_hash: str, max_pages: int, result: dict[str, Any]) -> None:
    try:
        cache_path = get_result_cache_path(file_hash, max_pages)
        tmp_path = f"{cache_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False)
        os.replace(tmp_path, cache_path)
    except Exception as exc:
        print("[catcare-ocr-cache] write failed", {"error": str(exc)}, flush=True)


def build_raw_text_from_pages(pages: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for page in pages:
        page_text = str(page.get("text") or "").strip()
        if page_text:
            chunks.append(f"=== 第{page.get('page', len(chunks) + 1)}页 ===\n{page_text}")
    return "\n\n".join(chunks).strip()


def build_fake_raw_text(filename: str) -> str:
    return f"""=== 第1页 ===
华城宠物诊疗中心
宠物姓名：示例宠物
报告日期：2026-04-20
主诊医生：李医生
主诉：复查血常规与肾功能相关指标，近期饮水偏多。
WBC 白细胞 16.2 10^9/L 参考范围 5.5-19.5
CREA 肌酐 190 umol/L 参考范围 70-165
USG 尿比重 1.016 参考范围 >1.035
腹部B超：双肾回声改变，膀胱壁轻度增厚。
医嘱：速诺 50mg 一次1片 饭后 一日2次 连续7天
复查建议：2026-04-29 复查血常规、生化、尿检。
文件名：{filename}
"""


def get_mode() -> str:
    mode = str(os.environ.get("OCR_MODE", "stub")).strip().lower()
    return "real" if mode == "real" else "stub"


def get_max_pages() -> int:
    return parse_max_pages(os.environ.get("OCR_MAX_PAGES", "1"), default=1)


def get_vision_max_pages() -> int:
    return parse_max_pages(os.environ.get("OCR_VISION_MAX_PAGES", "8"), default=8)


def build_meta(
    provider: str,
    mode: str,
    page_count: int,
    processed_pages: int,
    raw_text_chars: int,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "mode": mode,
        "pageCount": max(1, int(page_count or 1)),
        "processedPages": max(0, int(processed_pages or 0)),
        "rawTextChars": max(0, int(raw_text_chars or 0)),
        "needsManualReview": True,
        "warnings": warnings or [],
    }


def build_stub_pages(page_count: int, raw_text: str) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    for index in range(max(1, page_count)):
        page_text = raw_text if index == 0 else ""
        pages.append(
            {
                "page": index + 1,
                "text": page_text,
                "textChars": len(page_text),
            }
        )
    return pages


def build_controlled_failure(
    source_type: str,
    provider: str,
    mode: str,
    page_count: int,
    processed_pages: int,
    warning: str,
    error_summary: str,
) -> dict[str, Any]:
    return {
        "ok": False,
        "sourceType": source_type,
        "rawText": "",
        "pages": [],
        "error": error_summary,
        "meta": build_meta(
            provider=provider,
            mode=mode,
            page_count=page_count,
            processed_pages=processed_pages,
            raw_text_chars=0,
            warnings=[warning],
        ),
    }


def extract_ocr_stub(pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    page_count = get_pdf_page_count(pdf_bytes)
    render_meta = render_pdf_pages(pdf_bytes, max_pages=get_max_pages())
    raw_text = build_fake_raw_text(filename)

    return {
        "ok": True,
        "sourceType": "ocr_stub",
        "rawText": raw_text,
        "pages": build_stub_pages(page_count, raw_text),
        "meta": build_meta(
            provider="ocr_stub",
            mode="stub",
            page_count=page_count,
            processed_pages=len(render_meta),
            raw_text_chars=len(raw_text),
            warnings=["当前为 OCR skeleton 返回的模拟文本，尚未接入真实 OCR。"],
        ),
    }


def load_paddleocr() -> Any:
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"PaddleOCR 不可用: {exc}") from exc

    return PaddleOCR


# 模块级 singleton：进程内只初始化一次（首次约 20-60s 加载模型 + JIT，
# 之后每个请求毫秒级复用）。之前在 extract_ocr_real 内部反复 new PaddleOCR()
# 导致每个请求 60s+ 超时。
_PADDLE_OCR_INSTANCE: Any | None = None


def get_paddleocr_instance() -> Any:
    global _PADDLE_OCR_INSTANCE
    if _PADDLE_OCR_INSTANCE is None:
        PaddleOCR = load_paddleocr()
        _PADDLE_OCR_INSTANCE = PaddleOCR(
            use_textline_orientation=False,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            enable_mkldnn=False,
            lang="ch",
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="PP-OCRv5_mobile_rec",
        )
    return _PADDLE_OCR_INSTANCE


def _extract_texts_from_v3_dict(d: Any) -> list[str]:
    """从 PaddleOCR 3.x 返回的 dict-like 结构里抽取 rec_texts 列表。"""
    out: list[str] = []
    if not isinstance(d, dict):
        return out
    # 直接命中
    if "rec_texts" in d and isinstance(d["rec_texts"], (list, tuple)):
        for t in d["rec_texts"]:
            s = str(t).strip()
            if s:
                out.append(s)
        return out
    # 嵌套在 'res' 里
    if "res" in d:
        return _extract_texts_from_v3_dict(d["res"])
    # 直接 'texts' 备选
    if "texts" in d and isinstance(d["texts"], (list, tuple)):
        for t in d["texts"]:
            s = str(t).strip()
            if s:
                out.append(s)
    return out


def flatten_paddleocr_result(ocr_result: Any) -> str:
    """兼容 PaddleOCR 2.x（list 嵌套）+ 3.x（OCRResult 对象 / dict / rec_texts）格式。"""
    lines: list[str] = []
    if not ocr_result:
        return ""

    for block in ocr_result:
        if not block:
            continue

        # 3.x 新格式 A：block 是 dict-like
        if isinstance(block, dict):
            lines.extend(_extract_texts_from_v3_dict(block))
            continue

        # 3.x 新格式 B：block 是 OCRResult 对象，有 json 属性或可索引
        if hasattr(block, "json"):
            try:
                d = block.json if not callable(block.json) else block.json()
                if isinstance(d, dict):
                    extracted = _extract_texts_from_v3_dict(d)
                    if extracted:
                        lines.extend(extracted)
                        continue
            except Exception:
                pass

        # 3.x 新格式 C：直接访问对象属性
        for attr in ("rec_texts", "texts"):
            if hasattr(block, attr):
                try:
                    val = getattr(block, attr)
                    if isinstance(val, (list, tuple)):
                        for t in val:
                            s = str(t).strip()
                            if s:
                                lines.append(s)
                        break
                except Exception:
                    pass
        else:
            # 没命中任何 3.x 属性，尝试 dict-like 索引
            try:
                if "rec_texts" in block:
                    for t in block["rec_texts"]:
                        s = str(t).strip()
                        if s:
                            lines.append(s)
                    continue
            except Exception:
                pass

        # 2.x 旧格式：[[box, (text, score)], ...]
        if isinstance(block, list):
            for line in block:
                if not isinstance(line, list) or len(line) < 2:
                    continue
                text_meta = line[1]
                if isinstance(text_meta, (list, tuple)) and len(text_meta) >= 1:
                    text = str(text_meta[0]).strip()
                    if text:
                        lines.append(text)

    return "\n".join(lines).strip()


def run_paddleocr(ocr: Any, image_path: str) -> Any:
    if hasattr(ocr, "ocr"):
        return ocr.ocr(image_path)
    return ocr.predict(image_path)


def extract_ocr_real(pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    page_count = get_pdf_page_count(pdf_bytes)
    max_pages = get_max_pages()
    processed_pages = min(page_count, max_pages)
    started_at = perf_counter()
    file_hash = compute_file_hash(pdf_bytes)

    cached_result = read_cached_result(file_hash, max_pages)
    if cached_result:
        print(
            "[catcare-ocr-cache] hit",
            {
                "filename": filename,
                "fileHash": file_hash[:12],
                "provider": cached_result.get("meta", {}).get("provider"),
                "rawTextChars": cached_result.get("meta", {}).get("rawTextChars"),
                "pageCount": cached_result.get("meta", {}).get("pageCount"),
            },
            flush=True,
        )
        return cached_result

    text_pages = extract_pdf_text_pages(pdf_bytes, max_pages=max_pages)
    text_raw = build_raw_text_from_pages(text_pages)
    if len(text_raw) >= MIN_TEXT_LAYER_CHARS:
        duration_ms = int((perf_counter() - started_at) * 1000)
        result = {
            "ok": True,
            "sourceType": "ocr_real",
            "rawText": text_raw,
            "pages": text_pages,
            "meta": build_meta(
                provider="pymupdf_text",
                mode="real",
                page_count=page_count,
                processed_pages=len(text_pages),
                raw_text_chars=len(text_raw),
                warnings=["PDF 文本层由 PyMuPDF 提取，已跳过 OCR；仍需对照 PDF 原文人工确认。"],
            ),
        }
        result["meta"]["fileHash"] = file_hash
        result["meta"]["cacheHit"] = False
        write_cached_result(file_hash, max_pages, result)
        print(
            "[catcare-pymupdf-text] processed",
            {
                "filename": filename,
                "pageCount": page_count,
                "processedPages": len(text_pages),
                "rawTextChars": len(text_raw),
                "durationMs": duration_ms,
                "fileHash": file_hash[:12],
                "rawTextHead": text_raw[:220].replace("\n", " ⏎ "),
            },
            flush=True,
        )
        return result

    try:
        ocr = get_paddleocr_instance()  # singleton，避免每次请求重新加载模型
    except Exception as exc:
        return build_controlled_failure(
            source_type="ocr_real",
            provider="paddleocr",
            mode="real",
            page_count=page_count,
            processed_pages=processed_pages,
            warning="真实 OCR 初始化失败，Node 后端应继续 fallback。",
            error_summary=str(exc),
        )

    try:
        render_meta = render_pdf_pages(pdf_bytes, max_pages=max_pages)
        pages: list[dict[str, Any]] = []
        raw_text_chunks: list[str] = []

        with tempfile.TemporaryDirectory(prefix="catcare_ocr_") as temp_dir:
            for page in render_meta:
                page_number = int(page.get("page", len(pages) + 1))
                image_bytes = page.get("image_bytes", b"")
                image_path = os.path.join(temp_dir, f"page_{page_number}.png")
                with open(image_path, "wb") as handle:
                    handle.write(image_bytes)

                page_result = run_paddleocr(ocr, image_path)
                page_text = flatten_paddleocr_result(page_result)
                pages.append(
                    {
                        "page": page_number,
                        "text": page_text,
                        "textChars": len(page_text),
                    }
                )
                if page_text:
                    raw_text_chunks.append(f"=== 第{page_number}页 ===\n{page_text}")

        raw_text = "\n\n".join(raw_text_chunks).strip()
        duration_ms = int((perf_counter() - started_at) * 1000)
        # 调试摘要：只打印少量 OCR 文本头部，用于判断 OCR 质量
        print(
            "[catcare-ocr-real] processed",
            {
                "filename": filename,
                "pageCount": page_count,
                "processedPages": len(pages),
                "rawTextChars": len(raw_text),
                "durationMs": duration_ms,
                "fileHash": file_hash[:12],
                "rawTextHead": raw_text[:220].replace("\n", " ⏎ "),
            },
            flush=True,
        )

        if not raw_text:
            return build_controlled_failure(
                source_type="ocr_real",
                provider="paddleocr",
                mode="real",
                page_count=page_count,
                processed_pages=len(pages),
                warning="真实 OCR 未提取到可用文本，Node 后端应继续 fallback。",
                error_summary="真实 OCR 结果为空",
            )

        result = {
            "ok": True,
            "sourceType": "ocr_real",
            "rawText": raw_text,
            "pages": pages,
            "meta": build_meta(
                provider="paddleocr",
                mode="real",
                page_count=page_count,
                processed_pages=len(pages),
                raw_text_chars=len(raw_text),
                warnings=["当前为真实 OCR 文本，仍需对照 PDF 原文人工确认。"],
            ),
        }
        result["meta"]["fileHash"] = file_hash
        result["meta"]["cacheHit"] = False
        write_cached_result(file_hash, max_pages, result)
        return result
    except Exception as exc:
        return build_controlled_failure(
            source_type="ocr_real",
            provider="paddleocr",
            mode="real",
            page_count=page_count,
            processed_pages=processed_pages,
            warning="真实 OCR 执行异常，Node 后端应继续 fallback。",
            error_summary=str(exc),
        )


def render_pdf_images_for_vision(pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    page_count = get_pdf_page_count(pdf_bytes)
    max_pages = get_vision_max_pages()
    started_at = perf_counter()
    render_meta = render_pdf_pages(pdf_bytes, max_pages=max_pages, scale=2.0)
    images: list[str] = []
    for page in render_meta:
        image_bytes = page.get("image_bytes", b"")
        if not image_bytes:
            continue
        encoded = base64.b64encode(image_bytes).decode("ascii")
        images.append(f"data:image/png;base64,{encoded}")

    duration_ms = int((perf_counter() - started_at) * 1000)
    print(
        "[catcare-pdf-render] vision images",
        {
            "filename": filename,
            "pageCount": page_count,
            "processedPages": len(images),
            "durationMs": duration_ms,
        },
        flush=True,
    )
    return {
        "ok": len(images) > 0,
        "images": images,
        "meta": {
            "provider": "pymupdf_render",
            "pageCount": page_count,
            "processedPages": len(images),
            "droppedPages": max(0, page_count - len(images)),
            "durationMs": duration_ms,
        },
    }


def extract_ocr(pdf_bytes: bytes, filename: str) -> dict[str, Any]:
    if get_mode() != "real":
        return extract_ocr_stub(pdf_bytes, filename)

    return extract_ocr_real(pdf_bytes, filename)
