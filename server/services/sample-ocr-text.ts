export type DeepSeekSampleMode = "short" | "full";

function isInfectiousFilename(filename: string) {
  const normalized = String(filename || "").toLowerCase();
  return ["传染病", "fiv", "felv", "病毒检测"].some((keyword) => normalized.includes(keyword));
}

const SHORT_SAMPLE_OCR_TEXT = `=== 第1页 ===
华城宠物诊疗中心
宠物姓名：示例宠物
报告日期：2026-04-20
WBC 白细胞 16.2 10^9/L 参考范围 5.5-19.5
医嘱：速诺 50mg 一次1片 饭后 一日2次 连续7天
复查建议：2026-04-29 复查血常规。`;

const GENERAL_SAMPLE_OCR_TEXT = `=== 第1页 ===
华城宠物诊疗中心
宠物姓名：示例宠物
报告日期：2026-04-20
就诊日期：2026-04-20
就诊类型：复诊
主诊医生：李医生
主诉：复查血常规、生化及尿检，评估贫血与肾功能相关指标变化，近期饮水偏多。
体重：3.10 kg
体温：38.4℃
医生备注：继续按时服药，观察食欲、饮水和排尿情况。

=== 第2页 ===
血常规
WBC 白细胞 16.2 10^9/L 参考范围 5.5-19.5
RBC 红细胞 5.1 10^12/L 参考范围 6.5-10.0
HGB 血红蛋白 83 g/L 参考范围 93-153
HCT 红细胞压积 27 % 参考范围 30-45
PLT 血小板 410 10^9/L 参考范围 300-800

=== 第3页 ===
生化 / 尿检
CREA 肌酐 190 umol/L 参考范围 70-165
BUN 尿素氮 13 mmol/L 参考范围 5.7-12.9
ALT 谷丙转氨酶 82 U/L 参考范围 12-130
USG 尿比重 1.016 参考范围 >1.035
PRO 尿蛋白 弱阳性 参考范围 阴性

=== 第4页 ===
腹部B超
检查部位：肾脏、膀胱、腹腔
影像所见：双肾回声改变，膀胱壁轻度增厚。
影像提示：建议结合肾功能指标、尿检结果进一步评估。

=== 第5页 ===
医嘱处方
速诺 50mg 一次1片 饭后 一日2次 连续7天
护肝药 一次1粒 随餐 一日1次 连续14天
复查建议：2026-04-29 复查血常规、生化、尿检。`;

const INFECTIOUS_APPENDIX = `

=== 第6页 ===
传染病检测
FIV 猫艾滋 阴性
FeLV 猫白血病 阴性`;

export function normalizeSampleMode(value?: string): DeepSeekSampleMode {
  return String(value || "").trim().toLowerCase() === "full" ? "full" : "short";
}

export function getSampleOcrText(filename: string, sampleMode: DeepSeekSampleMode = "short") {
  const infectious = isInfectiousFilename(filename);
  if (sampleMode === "short") {
    return {
      sampleMode,
      sampleName: "sample_ocr_text_short_minimal",
      rawText: SHORT_SAMPLE_OCR_TEXT,
    };
  }

  return {
    sampleMode,
    sampleName: infectious ? "sample_ocr_text_infectious_followup" : "sample_ocr_text_general_followup",
    rawText: infectious ? `${GENERAL_SAMPLE_OCR_TEXT}${INFECTIOUS_APPENDIX}` : GENERAL_SAMPLE_OCR_TEXT,
  };
}
