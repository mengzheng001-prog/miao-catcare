from __future__ import annotations

import cgi
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ocr_pipeline import extract_ocr, get_mode, render_pdf_images_for_vision


HOST = os.environ.get("OCR_SERVICE_HOST", "0.0.0.0")
PORT = int(os.environ.get("OCR_SERVICE_PORT", "5005"))
MODE = get_mode()
DEFAULT_CACHE_ROOT = os.environ.get("OCR_CACHE_DIR") or "/tmp/catcare_ocr_cache"


def ensure_runtime_cache_dirs() -> None:
    os.makedirs(DEFAULT_CACHE_ROOT, exist_ok=True)
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", os.path.join(DEFAULT_CACHE_ROOT, "paddlex"))
    os.environ.setdefault("PADDLE_HOME", os.path.join(DEFAULT_CACHE_ROOT, "paddle"))
    os.environ.setdefault("HF_HOME", os.path.join(DEFAULT_CACHE_ROOT, "huggingface"))
    os.environ.setdefault("MODELSCOPE_CACHE", os.path.join(DEFAULT_CACHE_ROOT, "modelscope"))


class OcrHandler(BaseHTTPRequestHandler):
    server_version = "catcare-ocr-skeleton/0.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "service": "catcare-ocr-skeleton",
                "mode": MODE,
            },
        )

    def do_POST(self) -> None:
        if self.path not in ("/ocr/extract", "/pdf/render-images"):
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._send_json(400, {"ok": False, "error": "Expected multipart/form-data"})
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
            keep_blank_values=True,
        )

        file_field = form["file"] if "file" in form else None
        if file_field is None or not getattr(file_field, "file", None):
            self._send_json(400, {"ok": False, "error": "Missing PDF file"})
            return

        filename = getattr(file_field, "filename", None) or "uploaded.pdf"
        pdf_bytes = file_field.file.read()
        if self.path == "/pdf/render-images":
            try:
                result = render_pdf_images_for_vision(pdf_bytes, filename)
            except Exception as exc:
                result = {
                    "ok": False,
                    "images": [],
                    "error": f"PDF render service 内部异常: {exc}",
                    "meta": {"provider": "pymupdf_render", "pageCount": 1, "processedPages": 0},
                }
            self._send_json(200, result)
            return

        try:
            result = extract_ocr(pdf_bytes, filename)
        except Exception as exc:
            result = {
                "ok": False,
                "sourceType": "ocr_stub" if MODE == "stub" else "ocr_real",
                "rawText": "",
                "pages": [],
                "error": f"OCR service 内部异常: {exc}",
                "meta": {
                    "provider": "ocr_stub" if MODE == "stub" else "paddleocr",
                    "mode": MODE,
                    "pageCount": 1,
                    "processedPages": 0,
                    "rawTextChars": 0,
                    "needsManualReview": True,
                    "warnings": ["OCR service 内部异常，Node 后端应继续 fallback。"],
                },
            }
        self._send_json(200, result)


def main() -> None:
    ensure_runtime_cache_dirs()
    server = ThreadingHTTPServer((HOST, PORT), OcrHandler)
    print(f"[catcare-ocr-skeleton] listening on http://{HOST}:{PORT} mode={MODE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
