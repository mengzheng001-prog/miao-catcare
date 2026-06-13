type PromptInput = {
  reportId: string;
  filename: string;
  sampleName: string;
  sampleOcrText: string;
  parseSourceType: "deepseek_sample_ocr" | "ocr_stub_deepseek" | "ocr_real_deepseek";
  sourceLabel: string;
  parseWarning: string;
  /** 用户当前选中宠物的名字（可选）—— 当 PDF 中找不到宠物名时使用 */
  petNameHint?: string;
};

export function buildReportStructureSystemPrompt(input: Pick<PromptInput, "parseSourceType" | "parseWarning" | "petNameHint">) {
  const petHint = input.petNameHint
    ? `用户当前选中宠物名为「${input.petNameHint}」。如果 PDF 原文中没有明确提到宠物名字，请把 visitInfo.catName 设为该值；如果 PDF 明确写了不同的宠物名，请以 PDF 原文为准。`
    : "如果 PDF 原文中没有提到宠物名字，visitInfo.catName 留空字符串，不要编造。";

  return [
    "你是宠物医院 PDF / OCR 文本结构化整理助手。",
    "你只做结构化整理，输出必须是合法 JSON。",
    "你不能做诊断、不能给治疗方案、不能建议加药减药停药。",
    "",
    "【最重要的规则】",
    "1. 严禁编造 OCR 文本中不存在的内容。如果 PDF 中没明确写宠物名、医院、医生、主诉、指标值、影像结果、医嘱、复查建议，对应字段就留空字符串或空数组——绝对不要照抄示例值或自行填充。",
    "2. 严禁参考用户提示词中示例 JSON 里的具体内容（示例只用于结构参考，不要复制其中的「宠物名」「医院名」「医生名」「数值」等任何具体值）。",
    "3. 完整性优先：PDF 中出现的每一项化验指标、每一张影像报告、每一条医嘱、每一条复查建议，都必须出现在 JSON 中，不允许遗漏。",
    "4. 如果 PDF 包含多个日期的不同检查（例如 10/12 血常规 + 10/20 B 超 + 11/2 复查），请逐条提取，并在每条 lab/imaging/medication 记录中标注 sourcePage 与 reportDate（YYYY-MM-DD 格式），不要把不同日期的数据合并成一条。",
    "5. 如果 PDF 中有医生诊断、诊断意见、检查结论等原文，即使没有 B 超/心超图片，也要作为 imaging 记录提取；examType 写原文类别或「医生诊断」，finding/impression 只摘录原文，不补充新判断。",
    "6. visitInfo.reportDate 取 PDF 中最近一次就诊的日期；如果 PDF 是体检合集，取最后一次检查日期。",
    "",
    "【宠物名处理】",
    petHint,
    "",
    "【字段缺失处理】",
    "如果 OCR 文本中没有某字段，请按以下规则填空：",
    "- visitInfo.catName / hospital / doctor / chiefComplaint / presentIllness / pastHistory / weight / temperature / doctorNotes：留空字符串（不要写「待确认」「请补充」「-」之类的占位词，直接 \"\"）",
    "- visitInfo.reportDate / visitDate：必须填，从 PDF 推断；如完全无法推断使用今天日期",
    "- labs / imaging / medications / followups：如果 PDF 完全没有对应分组，返回空数组 []",
    "",
    "【输出结构】",
    "输出必须兼容 ReportConfirm draft：包含 reportId、parseMeta、fieldMeta、visitInfo、labs、imaging、medications、followups、aiSummary。",
    `parseMeta.sourceType 必须为 ${input.parseSourceType}，needsManualReview 必须为 true。`,
    `parseMeta.warnings 必须包含：${input.parseWarning}`,
    "labs 中 checked 默认 true，error 默认 false。",
    "labs / imaging / medications 中每条都应包含 sourcePage（如「第3页」），并尽量包含 reportDate（YYYY-MM-DD）。",
    "fieldMeta 尽量提供 sourcePage、confidence（0~1 小数）、sourceText（原文片段）。",
    "",
    "",
    "【JSON 严格格式】",
    "- 只输出 JSON，不要输出 markdown 代码块、不要输出额外解释。",
    "- 严禁在 JSON 中使用 // 或 /* */ 注释（标准 JSON 不允许）。",
    "- 严禁使用「此处省略」「省略其他指标」「同上」「...」等占位文字代指未列出的真实数据。",
    "- 如果输出可能很长，宁可继续输出完整内容，也不要省略或截断。每条 labs / imaging / medications 都必须独立完整列出。",
  ].join("\n");
}

export function buildReportStructureUserPrompt(input: PromptInput) {
  // 紧凑结构：只输出后端 normalize 不会自动补的核心字段。
  // 删除原因（每条都已在后端 fallback）：
  //   - id/code/min/max/confidence/checked/error（后端从 name/range/默认值生成）
  //   - parseMeta/fieldMeta/aiSummary/complaint/notes（后端重建）
  //   - visitInfo.userNotes/syncToCatProfile（后端 default）
  // 这样能把豆包输出压缩 40-50%，避免 12k token 上限被截断。
  const schemaExample = {
    visitInfo: {
      catName: "[PDF 中的宠物名]",
      reportDate: "[YYYY-MM-DD，PDF 中最近一次检查日期]",
      visitDate: "[YYYY-MM-DD，首次就诊日期]",
      hospital: "[医院名]",
      doctor: "[医生名]",
      visitType: "[初诊/复诊/体检/急诊/其他]",
      chiefComplaint: "[主诉原文]",
      presentIllness: "[现病史原文]",
      pastHistory: "[既往史/既往病史原文]",
      weight: "[如 3.10 kg]",
      temperature: "[如 38.4℃]",
      doctorNotes: "[医生备注 / 诊断意见原文]",
      followupText: "[复查建议描述]",
    },
    labs: [
      {
        group: "[血常规/生化/血气/尿检/传染病等；肾功/肝功小项归入生化]",
        name: "[指标中文名]",
        value: "[实测值]",
        unit: "[单位]",
        range: "[参考范围]",
        status: "[正常/偏低/偏高/异常/阳性/阴性]",
        sourcePage: "[页码]",
        reportDate: "[YYYY-MM-DD]",
      },
    ],
    imaging: [
      {
        examType: "[如 腹部B超]",
        bodyPart: "[如 肾脏、膀胱]",
        finding: "[影像所见原文]",
        impression: "[影像印象/结论]",
        sourcePage: "[页码]",
        reportDate: "[YYYY-MM-DD]",
      },
    ],
    medications: [
      {
        name: "[药物名]",
        dosage: "[剂量]",
        frequency: "[每日次数]",
        instruction: "[服药指引]",
        duration: "[疗程]",
        sourcePage: "[页码]",
        reportDate: "[YYYY-MM-DD]",
      },
    ],
    followups: [
      {
        title: "[复查名称]",
        date: "[YYYY-MM-DD]",
        desc: "[复查描述]",
        items: ["[复查项目]"],
        sourcePage: "[页码]",
      },
    ],
  };

  return [
    `请把下面这份${input.sourceLabel}结构化为 JSON。`,
    "",
    `reportId: ${input.reportId}`,
    `filename: ${input.filename}`,
    input.petNameHint ? `userPetNameHint: ${input.petNameHint}（用户在系统里设置的当前宠物名，PDF 中找不到宠物名时使用）` : "",
    "",
    "【目标 JSON 结构骨架，仅用于了解字段名和层次，不要复制其中的占位文本到输出】",
    JSON.stringify(schemaExample, null, 2),
    "",
    "【再次强调】",
    "- 输出 JSON 中绝对不能出现「[占位]」「[页码]」「[YYYY-MM-DD]」这类占位符。",
    "- 如果 PDF 含多个日期的检查，请逐条把每条指标 / 影像 / 医嘱标注 reportDate；不要把不同日期合并。",
    "- 指标 group 按检查项目归类：血常规、生化、血气、尿检、传染病等；肾功、肝功、电解质等生化小项统一归入「生化」。",
    "- 对中文病历里的「诊疗机构/医院/院区」提取到 visitInfo.hospital；「主诉」提取到 chiefComplaint；「现病史」提取到 presentIllness；「既往史/既往病史」提取到 pastHistory。",
    "- 严禁编造 PDF 中不存在的指标、医院、医生、医嘱。",
    "",
    `${input.sourceLabel}原文：`,
    input.sampleOcrText,
  ].filter(Boolean).join("\n");
}
