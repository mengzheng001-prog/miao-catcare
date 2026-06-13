type OcrPage = {
  page: number;
  text: string;
  textChars?: number;
};

type OcrExtractPayload = {
  ok: boolean;
  sourceType: "ocr_stub" | "ocr_real";
  rawText: string;
  pages: OcrPage[];
  error?: string;
  meta: {
    provider: string;
    mode: string;
    pageCount: number;
    processedPages: number;
    rawTextChars: number;
    needsManualReview: true;
    warnings: string[];
  };
};

export type OcrClientDiagnostics = {
  serviceUrl: string;
  mode: string;
  timeoutMs: number;
  rawTextChars: number;
  pageCount: number;
  processedPages: number;
  provider: string;
  sourceType: "ocr_stub" | "ocr_real";
  fallbackReason?: string;
};

export type OcrClientResult = {
  ok: boolean;
  data: OcrExtractPayload | null;
  diagnostics: OcrClientDiagnostics;
};

type OcrRenderImagesPayload = {
  ok: boolean;
  images: string[];
  error?: string;
  meta?: {
    provider?: string;
    pageCount?: number;
    processedPages?: number;
    droppedPages?: number;
    durationMs?: number;
  };
};

export type OcrRenderImagesResult = {
  ok: boolean;
  images: string[];
  diagnostics: {
    serviceUrl: string;
    timeoutMs: number;
    provider: string;
    pageCount: number;
    processedPages: number;
    droppedPages: number;
    durationMs?: number;
    fallbackReason?: string;
  };
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function parseTimeoutMs(value?: string) {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60000;
  }
  return parsed;
}

function getOcrConfig() {
  return {
    serviceUrl: trimTrailingSlash(process.env.OCR_SERVICE_URL || "http://localhost:5005"),
    mode: String(process.env.OCR_MODE || "stub").trim() || "stub",
    timeoutMs: parseTimeoutMs(process.env.OCR_TIMEOUT_MS),
  };
}

function createDiagnostics(config: ReturnType<typeof getOcrConfig>, overrides: Partial<OcrClientDiagnostics> = {}): OcrClientDiagnostics {
  const defaultSourceType = config.mode === "real" ? "ocr_real" : "ocr_stub";
  return {
    serviceUrl: config.serviceUrl,
    mode: config.mode,
    timeoutMs: config.timeoutMs,
    rawTextChars: 0,
    pageCount: 0,
    processedPages: 0,
    provider: defaultSourceType === "ocr_real" ? "paddleocr" : "ocr_stub",
    sourceType: defaultSourceType,
    ...overrides,
  };
}

function logOcr(event: string, diagnostics: OcrClientDiagnostics) {
  const payload = {
    serviceUrl: diagnostics.serviceUrl,
    mode: diagnostics.mode,
    timeoutMs: diagnostics.timeoutMs,
    rawTextChars: diagnostics.rawTextChars,
    pageCount: diagnostics.pageCount,
    processedPages: diagnostics.processedPages,
    provider: diagnostics.provider,
    sourceType: diagnostics.sourceType,
    fallbackReason: diagnostics.fallbackReason,
  };

  if (diagnostics.fallbackReason) {
    console.error(`[ocr-client] ${event}`, payload);
    return;
  }

  console.info(`[ocr-client] ${event}`, payload);
}

function isValidOcrResponse(payload: any): payload is OcrExtractPayload {
  return Boolean(
    payload
    && typeof payload.ok === "boolean"
    && (payload.sourceType === "ocr_stub" || payload.sourceType === "ocr_real")
    && typeof payload.rawText === "string"
    && Array.isArray(payload.pages)
    && payload.meta
    && typeof payload.meta.rawTextChars === "number"
  );
}

function isValidRenderImagesResponse(payload: any): payload is OcrRenderImagesPayload {
  return Boolean(
    payload
    && typeof payload.ok === "boolean"
    && Array.isArray(payload.images)
  );
}

export async function extractRawTextWithOcrService(input: { filename: string; fileBuffer: Buffer }): Promise<OcrClientResult> {
  const config = getOcrConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const formData = new FormData();
    formData.append("file", new Blob([input.fileBuffer], { type: "application/pdf" }), input.filename);

    const response = await fetch(`${config.serviceUrl}/ocr/extract`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const diagnostics = createDiagnostics(config, {
        fallbackReason: `OCR service 请求失败(${response.status})`,
      });
      logOcr("fallback", diagnostics);
      return { ok: false, data: null, diagnostics };
    }

    const payload = await response.json();
    if (!isValidOcrResponse(payload)) {
      const diagnostics = createDiagnostics(config, {
        fallbackReason: "OCR service 返回格式无效",
      });
      logOcr("fallback", diagnostics);
      return { ok: false, data: null, diagnostics };
    }

    if (!payload.ok || !payload.rawText.trim()) {
      const diagnostics = createDiagnostics(config, {
        rawTextChars: payload.meta.rawTextChars || 0,
        pageCount: payload.meta.pageCount || 0,
        processedPages: payload.meta.processedPages || 0,
        provider: payload.meta.provider || (payload.sourceType === "ocr_real" ? "paddleocr" : "ocr_stub"),
        sourceType: payload.sourceType,
        fallbackReason:
          payload.error
          || (Array.isArray(payload.meta.warnings) && payload.meta.warnings[0])
          || "OCR service 未提取到可用文本",
      });
      logOcr("fallback", diagnostics);
      return { ok: false, data: payload, diagnostics };
    }

    const diagnostics = createDiagnostics(config, {
      rawTextChars: payload.meta.rawTextChars,
      pageCount: payload.meta.pageCount,
      processedPages: payload.meta.processedPages || 0,
      provider: payload.meta.provider || "ocr_stub",
      sourceType: payload.sourceType,
    });
    logOcr("success", diagnostics);
    return {
      ok: true,
      data: payload,
      diagnostics,
    };
  } catch (error: any) {
    const diagnostics = createDiagnostics(config, {
      fallbackReason: error?.name === "AbortError"
        ? "OCR service 请求超时"
        : "OCR service 不可用",
    });
    logOcr("fallback", diagnostics);
    return { ok: false, data: null, diagnostics };
  } finally {
    clearTimeout(timeout);
  }
}

export async function renderPdfImagesWithOcrService(input: { filename: string; fileBuffer: Buffer }): Promise<OcrRenderImagesResult> {
  const config = getOcrConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  const baseDiagnostics = {
    serviceUrl: config.serviceUrl,
    timeoutMs: config.timeoutMs,
    provider: "pymupdf_render",
    pageCount: 0,
    processedPages: 0,
    droppedPages: 0,
  };

  try {
    const formData = new FormData();
    formData.append("file", new Blob([input.fileBuffer], { type: "application/pdf" }), input.filename);

    const response = await fetch(`${config.serviceUrl}/pdf/render-images`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const result = {
        ok: false,
        images: [],
        diagnostics: {
          ...baseDiagnostics,
          fallbackReason: `PDF render service 请求失败(${response.status})`,
        },
      };
      console.error("[ocr-client] render-images fallback", result.diagnostics);
      return result;
    }

    const payload = await response.json();
    if (!isValidRenderImagesResponse(payload)) {
      const result = {
        ok: false,
        images: [],
        diagnostics: {
          ...baseDiagnostics,
          fallbackReason: "PDF render service 返回格式无效",
        },
      };
      console.error("[ocr-client] render-images fallback", result.diagnostics);
      return result;
    }

    const diagnostics = {
      ...baseDiagnostics,
      provider: payload.meta?.provider || "pymupdf_render",
      pageCount: Number(payload.meta?.pageCount) || 0,
      processedPages: Number(payload.meta?.processedPages) || payload.images.length,
      droppedPages: Number(payload.meta?.droppedPages) || 0,
      durationMs: Number(payload.meta?.durationMs) || undefined,
      fallbackReason: payload.ok && payload.images.length > 0 ? undefined : (payload.error || "PDF render service 未生成页面图片"),
    };

    if (diagnostics.fallbackReason) {
      console.error("[ocr-client] render-images fallback", diagnostics);
      return { ok: false, images: [], diagnostics };
    }

    console.info("[ocr-client] render-images success", diagnostics);
    return { ok: true, images: payload.images, diagnostics };
  } catch (error: any) {
    const result = {
      ok: false,
      images: [],
      diagnostics: {
        ...baseDiagnostics,
        fallbackReason: error?.name === "AbortError" ? "PDF render service 请求超时" : "PDF render service 不可用",
      },
    };
    console.error("[ocr-client] render-images fallback", result.diagnostics);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
