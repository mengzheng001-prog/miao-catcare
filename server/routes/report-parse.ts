import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { runDeepSeekConnectivityTest } from "../services/deepseek";
import { createParseJob, getParseJobResult, getParseJobState } from "../services/job-store";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // 含 base64 页面图片时单次上传体积会变大，放宽到 80 MB
    fileSize: 80 * 1024 * 1024,
    // pageImages 是 base64 JSON 字符串字段（19 页约 10-30 MB），默认 1MB 太小
    fieldSize: 80 * 1024 * 1024,
    fields: 20,
  },
});

const createJobSchema = z.object({
  reportId: z.string().min(1),
  rawText: z.string().optional(),
  petName: z.string().optional(),
  // base64 dataURL 数组的 JSON 字符串（前端 JSON.stringify 后追加到 FormData）
  pageImages: z.string().optional(),
});

function parsePageImages(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

router.post("/parse", upload.single("file"), (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  const file = (req as any).file as {
    originalname?: string;
    size?: number;
    buffer?: Buffer;
  } | undefined;

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten(),
    });
  }

  if (!file) {
    return res.status(400).json({
      error: "Missing PDF file",
    });
  }

  let job;
  try {
    job = createParseJob({
      reportId: parsed.data.reportId,
      filename: file.originalname || "未命名报告.pdf",
      fileSizeBytes: file.size || 0,
      fileBuffer: file.buffer,
      clientRawText: parsed.data.rawText || "",
      petNameHint: parsed.data.petName || "",
      pageImages: parsePageImages(parsed.data.pageImages),
    });
  } catch (error: any) {
    console.error("[report-parse] create job failed", {
      reportId: parsed.data.reportId,
      jobId: error?.jobId,
      issues: error?.issues,
      error,
    });
    return res.status(500).json({
      error: "Internal server error",
    });
  }

  return res.status(201).json({
    jobId: job.jobId,
    reportId: job.reportId,
    status: "uploaded",
  });
});

router.get("/parse/:jobId", (req, res) => {
  const job = getParseJobState(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      error: "Parse job not found",
    });
  }

  return res.json(job);
});

router.get("/parse/:jobId/result", (req, res) => {
  const jobState = getParseJobState(req.params.jobId);
  if (!jobState) {
    return res.status(404).json({
      error: "Parse job not found",
    });
  }

  if (jobState.status !== "ready") {
    return res.status(409).json({
      error: "Parse job is not ready",
      status: jobState.status,
    });
  }

  const result = getParseJobResult(req.params.jobId);
  if (!result) {
    return res.status(404).json({
      error: "Parse result not found",
    });
  }

  return res.json(result);
});

router.get("/deepseek-test", async (_req, res) => {
  try {
    const result = await runDeepSeekConnectivityTest();
    return res.json(result);
  } catch (error) {
    console.error("[deepseek-test] failed", error);
    return res.status(500).json({
      ok: false,
      mode: "mock_fallback",
      error: "Internal server error",
    });
  }
});

export default router;
