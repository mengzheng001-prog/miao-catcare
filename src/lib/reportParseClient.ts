export type ParseJobStatus = "uploaded" | "rasterizing" | "ocr_running" | "llm_running" | "validating" | "ready" | "failed";

export type ParseJobResponse = {
  jobId: string;
  reportId: string;
  status: ParseJobStatus;
};

export async function uploadReportForParse(file: File, reportId: string, rawText?: string, petName?: string, pageImages?: string[]) {
  const formData = new FormData();
  formData.append("reportId", reportId);
  formData.append("file", file);
  // 前端用 pdfjs 抽出的 PDF 文本一起传给后端，让后端可以跳过 OCR 直接用 DeepSeek 解析
  if (rawText && rawText.trim()) {
    formData.append("rawText", rawText);
  }
  // 当前选中宠物名作为 LLM context hint（PDF 中找不到宠物名时使用）
  if (petName && petName.trim()) {
    formData.append("petName", petName);
  }
  // 扫描件 PDF 转出来的页面图片（base64 dataURL 数组），由豆包多模态识别
  if (pageImages && pageImages.length > 0) {
    formData.append("pageImages", JSON.stringify(pageImages));
  }

  const response = await fetch("/api/reports/parse", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to create parse job: ${response.status}`);
  }

  return response.json() as Promise<ParseJobResponse>;
}

export async function getParseJob(jobId: string) {
  const response = await fetch(`/api/reports/parse/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch parse job: ${response.status}`);
  }

  return response.json() as Promise<ParseJobResponse & { filename?: string }>;
}

export async function getParseResult(jobId: string) {
  const response = await fetch(`/api/reports/parse/${jobId}/result`);
  if (!response.ok) {
    throw new Error(`Failed to fetch parse result: ${response.status}`);
  }

  return response.json() as Promise<any>;
}
