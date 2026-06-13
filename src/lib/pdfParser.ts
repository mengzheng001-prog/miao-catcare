import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

export type TextExtractionStatus = "success" | "empty" | "error";

export type ParsedVisitInfo = {
  catName: string;
  reportDate: string;
  visitDate: string;
  hospital: string;
  doctor: string;
  visitType: string;
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  weight: string;
  temperature: string;
  doctorNotes: string;
  followupText: string;
};

export async function extractPdfPagesAsImages(file: File, opts?: { maxPages?: number; scale?: number; quality?: number }) {
  const maxPages = opts?.maxPages ?? 20;
  const scale = opts?.scale ?? 2;
  const quality = opts?.quality ?? 0.82;

  try {
    const data = await file.arrayBuffer();
    const task = (pdfjsLib as any).getDocument({ data });
    const pdf = await task.promise;
    const totalPages = pdf.numPages;
    const pagesToProcess = Math.min(totalPages, maxPages);
    const images: string[] = [];

    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      images.push(dataUrl);
    }

    await pdf.destroy();

    return {
      images,
      totalPages,
      processedPages: images.length,
      droppedPages: totalPages - images.length,
    };
  } catch (error) {
    console.error("extractPdfPagesAsImages failed", error);
    return {
      images: [],
      totalPages: 0,
      processedPages: 0,
      droppedPages: 0,
    };
  }
}

export async function extractPdfTextFromFile(file: File) {
  try {
    const data = await file.arrayBuffer();
    const task = (pdfjsLib as any).getDocument({ data });
    const pdf = await task.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => String(item?.str || "").trim())
        .filter(Boolean)
        .join(" ");

      if (pageText) {
        pages.push(pageText);
      }
    }

    const rawText = normalizeText(pages.join("\n"));
    await pdf.destroy();

    if (!rawText) {
      return {
        rawText: "",
        textExtractionStatus: "empty" as TextExtractionStatus,
        textExtractionMessage: "当前PDF可能是扫描件或图片型PDF，本地文本解析无法识别。请对照左侧PDF原文手动校对结构化结果。后续可接入OCR或多模态模型实现自动识别。",
      };
    }

    return {
      rawText,
      textExtractionStatus: "success" as TextExtractionStatus,
      textExtractionMessage: "已从文本型PDF中提取到文字，系统已尝试自动识别就诊信息。",
    };
  } catch (error) {
    console.error(error);
    return {
      rawText: "",
      textExtractionStatus: "error" as TextExtractionStatus,
      textExtractionMessage: "当前PDF可能是扫描件或图片型PDF，本地文本解析无法识别。请对照左侧PDF原文手动校对结构化结果。后续可接入OCR或多模态模型实现自动识别。",
    };
  }
}

export function parseVisitInfoFromText(rawText: string, filename = "", fallbackCatName = "未命名宠物"): ParsedVisitInfo {
  const text = normalizeText(rawText);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const inferredDate = extractLabeledDate(text) || extractDate(text) || extractDate(filename);
  const visitType = inferVisitType(text, filename);

  return {
    catName: extractNamedValue(lines, ["猫咪姓名", "宠物姓名", "姓名", "患宠", "宠物名", "猫名"]) || fallbackCatName,
    reportDate: inferredDate,
    visitDate: inferredDate,
    hospital: extractHospital(lines),
    doctor: extractDoctor(lines),
    visitType,
    chiefComplaint: extractSection(lines, ["主诉", "就诊原因"]) || "请根据PDF原文补充",
    presentIllness: extractSection(lines, ["现病史", "现病史描述", "当前病史"]),
    pastHistory: extractSection(lines, ["既往史", "既往病史", "病史"]),
    weight: extractWeight(text),
    temperature: extractTemperature(text),
    doctorNotes: extractSection(lines, ["医生备注", "诊断意见", "处理意见", "备注", "医嘱"]) || "请根据PDF原文补充",
    followupText: extractFollowup(lines),
  };
}

function normalizeText(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractLabeledDate(text: string) {
  const match = String(text || "").match(/(?:报告日期|就诊日期|检查日期|采样日期|检验日期)\s*[:：]?\s*(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function extractDate(text: string) {
  const match = String(text || "").match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function inferVisitType(text: string, filename: string) {
  const source = `${text}\n${filename}`.toLowerCase();
  if (source.includes("初诊")) return "初诊";
  if (source.includes("复查") || source.includes("复诊")) return "复诊";
  if (source.includes("体检")) return "体检";
  if (source.includes("急诊")) return "急诊";
  if (source.includes("b超") || source.includes("尿检") || source.includes("生化") || source.includes("检查")) return "检查";
  return "其他";
}

function extractNamedValue(lines: string[], labels: string[]) {
  const regex = new RegExp(`(?:${labels.join("|")})\\s*[:：]?\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(regex);
    if (match?.[1]) {
      return cleanExtractedValue(match[1]);
    }
  }
  return "";
}

function extractSection(lines: string[], labels: string[]) {
  const labelRegex = new RegExp(`(?:${labels.join("|")})\\s*[:：]?\\s*(.*)$`, "i");
  const nextFieldRegex = /(报告日期|就诊日期|检查日期|医院|诊疗机构|院区|医生|体重|体温|备注|主诉|现病史|既往史|既往病史|病史|医嘱|建议|复查|复诊|猫咪姓名|宠物姓名)/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(labelRegex);
    if (!match) continue;

    const inlineValue = cleanExtractedValue(match[1]);
    if (inlineValue) {
      return inlineValue;
    }

    const nextLine = lines[index + 1];
    if (nextLine && !nextFieldRegex.test(nextLine)) {
      return cleanExtractedValue(nextLine);
    }
  }

  return "";
}

function extractHospital(lines: string[]) {
  const direct = extractNamedValue(lines, ["医院", "就诊医院", "医院名称"]);
  if (direct) return direct;

  const hospitalLine = lines.find((line) => /(动物医院|宠物医院|动物诊所|宠物诊所|诊疗中心|医疗中心)/.test(line));
  return hospitalLine ? cleanExtractedValue(hospitalLine) : "待确认";
}

function extractDoctor(lines: string[]) {
  const direct = extractNamedValue(lines, ["医生", "医师", "主治", "兽医"]);
  if (direct) return direct;

  const doctorLine = lines.find((line) => /(医生|医师|主治|兽医)/.test(line));
  if (!doctorLine) return "待确认";

  const match = doctorLine.match(/(?:医生|医师|主治|兽医)\s*[:：]?\s*([^\s，,；;]+)/);
  return match?.[1] ? cleanExtractedValue(match[1]) : "待确认";
}

function extractWeight(text: string) {
  const match = String(text || "").match(/(?:体重|BW|Weight)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|KG|Kg|公斤)?/i);
  if (!match?.[1]) return "";
  const unit = match[2] ? (match[2].toLowerCase() === "公斤" ? "kg" : match[2]) : "kg";
  return `${match[1]} ${unit}`.trim();
}

function extractTemperature(text: string) {
  const match = String(text || "").match(/(?:体温|Temperature|Temp|(?:^|\b)T(?:\b|$))\s*[:：]?\s*([0-9]{2}(?:\.[0-9])?)\s*(℃|°C|C)?/i);
  if (!match?.[1]) return "";
  return `${match[1]}${match[2] || "℃"}`;
}

function extractFollowup(lines: string[]) {
  const direct = extractSection(lines, ["复查建议", "建议复查", "复诊建议"]);
  if (direct) return direct;

  const followupLine = lines.find((line) => /(建议复查|复查|复诊)/.test(line));
  return followupLine ? cleanExtractedValue(followupLine) : "";
}

function cleanExtractedValue(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[：:;；，,\-]+/, "")
    .trim();
}
