import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2 } from "lucide-react";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

const USE_NATIVE_PDF_PREVIEW = true;

interface PdfPreviewProps {
  /** data URL / blob URL / 远程 URL */
  src: string;
  /** 文件名（用于下载） */
  filename?: string;
  /** 容器最大高度 */
  className?: string;
}

/**
 * 用 PDF.js 把 PDF 渲染到 canvas。
 * - 比 iframe 兼容性更高（不依赖浏览器内置 PDF viewer）
 * - 支持翻页、缩放
 * - 同时提供下载按钮兜底
 */
export const PdfPreview: React.FC<PdfPreviewProps> = ({ src, filename = "report.pdf", className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载 PDF
  useEffect(() => {
    if (USE_NATIVE_PDF_PREVIEW) {
      setPdfDoc(null);
      setTotalPages(0);
      setPageNum(1);
      setError(src ? null : "没有可预览的 PDF 内容");
      setLoading(false);
      return;
    }

    if (!src) {
      setPdfDoc(null);
      setTotalPages(0);
      setPageNum(1);
      setError("没有可预览的 PDF 内容");
      setLoading(false);
      return;
    }
    let cancelled = false;
    let loadedDoc: any = null;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setTotalPages(0);
    setPageNum(1);
    (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`PDF 读取失败(${response.status})`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        const loadingTask = (pdfjsLib as any).getDocument({ data });
        const doc = await loadingTask.promise;
        loadedDoc = doc;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setPageNum(1);
      } catch (e: any) {
        console.error("PdfPreview 加载失败", e);
        if (!cancelled) setError(e?.message || "PDF 加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (loadedDoc?.destroy) {
        void loadedDoc.destroy();
      }
    };
  }, [src]);

  // 渲染指定页
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // 按容器宽度自适应 + 高 DPI 适配
        const containerWidth = canvas.parentElement?.clientWidth || 360;
        const viewportBase = page.getViewport({ scale: 1 });
        const scale = Math.min(2, containerWidth / viewportBase.width);
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        console.error("PdfPreview 渲染失败", e);
        if (!cancelled) setError("PDF 单页渲染失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNum]);

  const handlePrev = () => setPageNum((p) => Math.max(1, p - 1));
  const handleNext = () => setPageNum((p) => Math.min(totalPages, p + 1));

  if (USE_NATIVE_PDF_PREVIEW && src && !error) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 bg-slate-50 text-xs">
          <span className="text-slate-600 select-none">PDF 原文预览</span>
          <a
            href={src}
            download={filename}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            <Download className="w-3.5 h-3.5" />
            下载
          </a>
        </div>
        <object data={src} type="application/pdf" className="flex-1 w-full bg-white">
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-sm text-slate-500">
            <FileText className="w-10 h-10 text-slate-300 mb-3" />
            <p className="font-medium text-slate-700 mb-1">浏览器无法直接显示 PDF</p>
            <a href={src} download={filename} className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
              <Download className="w-3.5 h-3.5" />
              下载 PDF 到本地查看
            </a>
          </div>
        </object>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center text-sm text-slate-500 ${className}`}>
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        正在加载 PDF...
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center text-center p-6 text-sm text-slate-500 ${className}`}>
        <FileText className="w-10 h-10 text-slate-300 mb-3" />
        <p className="font-medium text-slate-700 mb-1">无法在浏览器内预览</p>
        <p className="text-xs leading-relaxed mb-4">{error}</p>
        {src && (
          <a
            href={src}
            download={filename}
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
          >
            <Download className="w-3.5 h-3.5" />
            下载 PDF 到本地查看
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 翻页 + 下载 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 bg-slate-50 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrev}
            disabled={pageNum <= 1}
            className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
            aria-label="上一页"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-slate-600 select-none">
            第 {pageNum} / {totalPages} 页
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={pageNum >= totalPages}
            className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
            aria-label="下一页"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {src && (
          <a
            href={src}
            download={filename}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            <Download className="w-3.5 h-3.5" />
            下载
          </a>
        )}
      </div>
      {/* canvas */}
      <div className="flex-1 overflow-auto bg-slate-100 p-3 flex justify-center items-start">
        <canvas ref={canvasRef} className="shadow-md bg-white" />
      </div>
    </div>
  );
};
