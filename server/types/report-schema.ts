import { z } from "zod";

export const parseJobStatusSchema = z.enum([
  "uploaded",
  "rasterizing",
  "ocr_running",
  "llm_running",
  "validating",
  "ready",
  "failed",
]);

export const parseResultSourceTypeSchema = z.enum([
  "mock_backend",
  "deepseek_sample_ocr",
  "ocr_stub_deepseek",
  "ocr_real_deepseek",
]);

export const fieldMetaItemSchema = z.object({
  sourcePage: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceText: z.string().optional(),
});

export const reportParseResultSchema = z.object({
  reportId: z.string(),
  parseMeta: z.object({
    sourceType: parseResultSourceTypeSchema,
    needsManualReview: z.literal(true),
    warnings: z.array(z.string()),
    provider: z.string().optional(),
    model: z.string().optional(),
    sampleOcrTextName: z.string().optional(),
  }),
  fieldMeta: z.record(z.string(), fieldMetaItemSchema).optional(),
  visitInfo: z.object({
    catName: z.string(),
    reportDate: z.string(),
    visitDate: z.string(),
    hospital: z.string(),
    doctor: z.string(),
    visitType: z.string(),
    chiefComplaint: z.string(),
    complaint: z.string().optional(),
    presentIllness: z.string().default(""),
    pastHistory: z.string().default(""),
    weight: z.string(),
    temperature: z.string(),
    doctorNotes: z.string(),
    notes: z.string().optional(),
    followupText: z.string(),
    userNotes: z.string().default(""),
    syncToCatProfile: z.boolean().default(false),
  }),
  labs: z.array(
    z.object({
      id: z.string(),
      group: z.string(),
      name: z.string(),
      code: z.string(),
      value: z.union([z.string(), z.number()]),
      unit: z.string(),
      range: z.string(),
      min: z.union([z.string(), z.number()]),
      max: z.union([z.string(), z.number()]),
      status: z.string(),
      sourcePage: z.string(),
      // 单 PDF 含多日期检查时，标注该指标所属的检查日期（YYYY-MM-DD）
      reportDate: z.string().default(""),
      confidence: z.number(),
      checked: z.boolean(),
      error: z.boolean(),
    })
  ),
  imaging: z.array(
    z.object({
      id: z.string(),
      examType: z.string(),
      bodyPart: z.string(),
      finding: z.string(),
      impression: z.string(),
      sourcePage: z.string(),
      reportDate: z.string().default(""),
    })
  ),
  medications: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      drugName: z.string(),
      time: z.string(),
      dosage: z.string(),
      frequency: z.string(),
      instruction: z.string(),
      duration: z.string(),
      status: z.string(),
      sourcePage: z.string(),
      reportDate: z.string().default(""),
    })
  ),
  followups: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      date: z.string(),
      desc: z.string(),
      items: z.array(z.string()),
      sourcePage: z.string(),
    })
  ),
  aiSummary: z.string(),
  updatedAt: z.string(),
});

export type ParseJobStatus = z.infer<typeof parseJobStatusSchema>;
export type ReportParseResult = z.infer<typeof reportParseResultSchema>;
