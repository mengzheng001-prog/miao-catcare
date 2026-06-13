from __future__ import annotations

from time import perf_counter
from typing import Any

import fitz


def get_pdf_page_count(pdf_bytes: bytes) -> int:
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            return max(1, int(document.page_count))
    except Exception:
        return 1


def parse_max_pages(value: Any, default: int = 1) -> int:
    try:
        parsed = int(str(value).strip())
    except Exception:
        return default

    if parsed <= 0:
        return default

    return parsed


def normalize_pdf_text(text: str) -> str:
    return "\n".join(line.strip() for line in str(text or "").splitlines() if line.strip())


def extract_pdf_text_pages(pdf_bytes: bytes, max_pages: int = 20) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            limit = min(document.page_count, max(1, max_pages))
            for page_index in range(limit):
                page = document.load_page(page_index)
                page_text = normalize_pdf_text(page.get_text("text"))
                pages.append(
                    {
                        "page": page_index + 1,
                        "text": page_text,
                        "textChars": len(page_text),
                    }
                )
    except Exception:
        return []

    return pages


def render_pdf_pages(pdf_bytes: bytes, max_pages: int = 1, scale: float = 2.0) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    started_at = perf_counter()

    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            matrix = fitz.Matrix(scale, scale)
            limit = min(document.page_count, max(1, max_pages))
            for page_index in range(limit):
                page = document.load_page(page_index)
                pixmap = page.get_pixmap(matrix=matrix)
                pages.append(
                    {
                        "page": page_index + 1,
                        "width": pixmap.width,
                        "height": pixmap.height,
                        "image_bytes": pixmap.tobytes("png"),
                    }
                )
    except Exception:
        return [{"page": 1, "width": 0, "height": 0, "image_bytes": b"", "renderDurationMs": int((perf_counter() - started_at) * 1000)}]

    if not pages:
        return [{"page": 1, "width": 0, "height": 0, "image_bytes": b"", "renderDurationMs": int((perf_counter() - started_at) * 1000)}]

    duration_ms = int((perf_counter() - started_at) * 1000)
    for item in pages:
        item["renderDurationMs"] = duration_ms
    return pages
