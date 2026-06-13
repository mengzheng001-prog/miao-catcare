// 检查项分类字典 —— 按宠物医院常见 PDF 报告的检查项命名整理。
// 用户偏好：按 PDF 原文 group 字段为主，code 白名单作为兜底（解决 HCT 错归血气等问题）。
//
// 分类决策顺序：
//   1) mapGroupNameToCategory(PDF 原文 group)  — 字典里 group 名字直接归类
//   2) resolveCategoryByCode(code) — code 白名单（用于 PDF 没标 group 时）
//   3) NAME_TO_CODE_MAP + 标准化 code 后再走 1/2
//   4) normalizeTrendCheckCategory(legacy regex 兜底)

export const TREND_CHECK_CATEGORIES = [
  "全部",
  "血常规",
  "生化",
  "血气",
  "尿检",
  "传染病",
  "B超/心超",
  "其他",
] as const;

// ============================================================
// §2 血常规（CBC 五分类） + §3 网织红细胞（用户要求归"其他"，所以这里只列血常规本体）
// ============================================================
const BLOOD_ROUTINE_CODES = new Set([
  "WBC",
  "NEU", "NEU%", "NEU#",
  "LYM", "LYM%", "LYM#", "LYMPH", "LYMPH%",
  "MON", "MON%", "MON#", "MONO",
  "EOS", "EOS%", "EOS#",
  "BAS", "BAS%", "BAS#", "BASO",
  "RBC",
  "HGB",
  "HCT",  // 注意：血气里也有 Hct，靠 group 区分
  "MCV", "MCH", "MCHC",
  "RDW-CV", "RDWCV", "RDW-SD", "RDWSD", "RDW",
  "PLT", "MPV", "PDW", "PCT",
]);

// ============================================================
// §4 生化 / 肾功 / 电解质（17 项 + 10 项 + 单项肾功）
// ============================================================
const BIOCHEMISTRY_CODES = new Set([
  "GLU",       // 血糖（血气里也有 GLU，靠 group 区分）
  "CREA", "CRE",
  "BUN", "UREA", "BUN/CREA",
  "PHOS", "P", "IP",
  "CA",
  "TP",
  "ALB",
  "GLOB",
  "ALB/GLOB", "A/G",
  "ALT",
  "ALKP", "ALP",
  "GGT",
  "TBIL", "DBIL", "IBIL", "TBA",
  "CHOL", "TC", "HDL", "LDL",
  "AMYL", "AMY", "LIPA",
  "AST",
  "SDMA",
  "GLU/CREA",
  "TG",
  "CK", "LDH",
  "NA", "K", "CL", "MG", "FE",
  "血浆颜色",
]);

// ============================================================
// §5 血气分析（注意：含 Hct / GLU / pH 与其他组重名，区分靠 group）
// ============================================================
const BLOOD_GAS_CODES = new Set([
  "PH",        // 血气里的 pH，跟尿检 pH 重名
  "PCO2", "PO2",
  "NA+", "K+", "CL-", "CA++",
  "CA++ AT PH 7.4", "CA(7.4)",
  "POP", "OSMO",
  "SO2 EST", "SO2", "SAT",
  "THB EST", "THB",
  "LAC", "LACTATE",
  "CH+",
  "HCO3-ACT", "HCO3", "BICARB",
  "BE ECF", "CBASE CF(V)", "CBASECFV", "BE", "ABE", "SBE",
  "ANGAP", "AG",  // 注意：血气 AG 跟血常规没冲突（AG 在字典里是 anion gap）
  // 注意：Hct 和 GLU 在血气里也存在，但因为也在血常规/生化里，靠 group 区分；
  // 这里不放，让 BLOOD_ROUTINE/BIOCHEMISTRY 在 PDF 没标 group 时优先。
]);

// ============================================================
// §6+§7+§8 尿检（尿常规 + UPC + 尿沉渣）
// ============================================================
const URINE_CODES = new Set([
  "USG", "尿比重",
  "KET", "URO", "BIL",
  "隐血", "隐血-溶血", "隐血-非溶血", "BLD",
  "NIT",
  "UPC", "UPRO", "U-PRO", "UCRE", "U-CRE", "U-PCR",
  "PRO",
  "PH-U",  // 尿 pH 显式标记
  "采样方式", "颜色", "透明度",
  // 尿沉渣镜检字段：用名字识别
  "镜检", "镜检图", "染色图",
]);

// ============================================================
// §13 传染病 / 抗体检测
// ============================================================
const INFECTIOUS_CODES = new Set([
  "FPV AB", "FCV AB", "FHV AB",
  "FPV", "FCV", "FHV",
  "FIV", "FELV", "FCOV",
]);

// ============================================================
// 其他：§3 网织红 + §9 凝血 + §10 输血 + §11 胸腹水 + §12 心肌标志物
// ============================================================
const OTHER_CODES = new Set([
  // §3 网织红细胞
  "RETIC", "RETIC%",
  // §9 凝血
  "PT", "APTT", "FIB", "TT",
  // §10 输血
  "血型", "主侧", "副侧", "交叉配血",
  // §11 胸腹水
  "TCC", "李凡他试验", "李凡他",
  // §12 心肌标志物
  "F-CTNI", "CTNI",
]);

// ============================================================
// §14+§15 B 超 / 心超 —— 影像类不进 lab 趋势卡片，统一归一个 tab。
// 这里列出关键词，让 normalizeTrendCheckCategory 能识别。
// ============================================================
const IMAGING_KEYWORDS_REGEX =
  /(腹部超声|心脏超声|心超|彩超|B\s*超|心脏彩超|腹部彩超|超声所见|超声提示|超声检查|M型|M\s*mode|B型|Doppler|多普勒|EF|FS|LVID|LA:AO|PA:AO|LAD|RAD)/i;

// ============================================================
// §1 体格检查 / 生命体征 —— 不算化验指标，从 indicators 排除
// ============================================================
const VITAL_SIGNS_CODES = new Set([
  "T", "BT", "TEMP", "TEMPERATURE", "体温",
  "HR", "PR", "心率", "脉搏",
  "RR", "呼吸", "呼吸频率",
  "BP", "SBP", "DBP", "血压",
  "CRT", "毛细血管再充盈时间",
  "瞳孔",
  "BCS",  // 体况评分
]);

// ============================================================
// PDF 原文 group 字段（用户偏好的"按 PDF 写的分类"）→ 8 个 tab 之一
// ============================================================
function mapGroupNameToCategory(rawGroup: string): string | null {
  const g = String(rawGroup || "").trim();
  if (!g) return null;

  // 血常规（含 CBC、全血细胞计数）
  if (/(血常规|血\s*液\s*常规|全血细胞|\bCBC\b|血液\/炎症|五分类)/i.test(g)) return "血常规";

  // 血气
  if (/(血气|\bABG\b|\bVBG\b|blood\s*gas)/i.test(g)) return "血气";

  // 尿检（尿常规、尿沉渣、UPC、尿液微量蛋白）
  if (/(尿\s*常规|尿检|尿\s*液|尿沉渣|镜检|UPC|尿\s*蛋白)/i.test(g)) return "尿检";

  // 传染病
  if (/(传染|抗体|猫\s*三联|猫\s*瘟|猫白血病|猫艾滋|FPV|FCV|FHV|FELV|FIV)/i.test(g)) return "传染病";

  // B超 / 心超 / 影像
  if (IMAGING_KEYWORDS_REGEX.test(g)) return "B超/心超";

  // 其他（凝血 / 输血 / 网织红 / 胸腹水 / 心肌）
  if (/(凝血|PT\/APTT|凝血四项)/i.test(g)) return "其他";
  if (/(输血|血型鉴定|交叉配血)/i.test(g)) return "其他";
  if (/(网织红|RETIC)/i.test(g)) return "其他";
  if (/(胸腹水|腹腔液|李凡他)/i.test(g)) return "其他";
  if (/(心肌标志物|cTnI|f-cTnI)/i.test(g)) return "其他";

  // 生化 / 肾功 / 电解质
  if (/(生化|肾功|肝功|肝胆|肾脏\s*功能|电解质|肌酐|尿素|总胆|白蛋白|球蛋白|chem|chemistry)/i.test(g)) return "生化";

  return null;
}

// ============================================================
// 中文 / 别称 → 标准 code 映射（字典原文 + 常见别称）
// 用途：保证同一指标在不同 PDF 里能合并同类项（趋势卡片共用一张）
// ============================================================
const NAME_TO_CODE_MAP: Record<string, string> = {
  // §2 血常规
  "白细胞": "WBC", "白细胞数目": "WBC", "白细胞总数": "WBC", "白细胞计数": "WBC",
  "中性粒细胞数目": "NEU", "中性粒细胞": "NEU", "中性细胞数目": "NEU",
  "中性粒细胞百分比": "NEU%", "中性细胞百分比": "NEU%",
  "淋巴细胞数目": "LYM", "淋巴细胞": "LYM",
  "淋巴细胞百分比": "LYM%",
  "单核细胞数目": "MON", "单核细胞": "MON",
  "单核细胞百分比": "MON%",
  "嗜酸细胞数目": "EOS", "嗜酸性粒细胞": "EOS",
  "嗜酸细胞百分比": "EOS%",
  "嗜碱细胞数目": "BAS", "嗜碱性粒细胞": "BAS",
  "嗜碱细胞百分比": "BAS%",
  "红细胞": "RBC", "红细胞数目": "RBC", "红细胞总数": "RBC", "红细胞计数": "RBC",
  "血红蛋白": "HGB", "血红蛋白浓度": "HGB", "血色素": "HGB",
  "红细胞压积": "HCT", "红细胞比容": "HCT", "血细胞比容": "HCT",
  "平均红细胞体积": "MCV",
  "平均血红蛋白量": "MCH",
  "平均血红蛋白浓度": "MCHC",
  "红细胞分布宽度": "RDW", "红细胞分布宽度变异系数": "RDW-CV", "红细胞分布宽度标准差": "RDW-SD",
  "血小板": "PLT", "血小板数目": "PLT", "血小板计数": "PLT",
  "平均小板体积": "MPV", "平均血小板体积": "MPV",
  "血小板分布宽度": "PDW",
  "血小板压积": "PCT",

  // §3 网织红细胞（归"其他"）
  "网织红细胞": "RETIC", "网织红细胞数目": "RETIC", "网织红细胞总数": "RETIC", "网织红细胞绝对值": "RETIC",
  "网织红细胞比率": "RETIC%", "网织红细胞百分比": "RETIC%", "网织红细胞%": "RETIC%",

  // §2 血常规：百分比中文名补全
  "嗜酸性粒细胞百分比": "EOS%", "嗜酸细胞百分比": "EOS%",
  "嗜碱性粒细胞百分比": "BAS%", "嗜碱细胞百分比": "BAS%",
  "单核细胞百分比": "MON%",
  "中性粒细胞百分比": "NEU%", "中性细胞百分比": "NEU%",
  "淋巴细胞百分比": "LYM%",

  // §4 生化
  "血糖": "GLU", "葡萄糖": "GLU",
  "肌酐": "CREA",
  "尿素氮": "BUN", "尿素": "BUN",
  "尿素氮/肌酐比": "BUN/CREA",
  "磷": "PHOS", "无机磷": "PHOS", "血磷": "PHOS",
  "钙": "CA",
  "总蛋白": "TP",
  "白蛋白": "ALB",
  "球蛋白": "GLOB",
  "白蛋白/球蛋白比": "ALB/GLOB", "白球比": "A/G",
  "丙氨酸转氨酶": "ALT", "丙氨酸氨基转移酶": "ALT", "谷丙转氨酶": "ALT", "谷丙": "ALT",
  "碱性磷酸酶": "ALKP",
  "γ-谷氨酰转肽酶": "GGT", "谷氨酰转肽酶": "GGT",
  "总胆红素": "TBIL",
  "直接胆红素": "DBIL", "间接胆红素": "IBIL",
  "胆固醇": "CHOL", "总胆固醇": "CHOL",
  "淀粉酶": "AMYL",
  "脂肪酶": "LIPA",
  "天门冬氨酸氨基转移酶": "AST", "谷草转氨酶": "AST", "谷草": "AST",
  "对称二甲基精氨酸": "SDMA",
  "甘油三酯": "TG",
  "肌酸激酶": "CK", "乳酸脱氢酶": "LDH",
  "钠": "NA", "钾": "K", "氯": "CL", "镁": "MG",

  // §5 血气分析（注意：与尿检 pH 重名，由 group 上下文区分到 PH-U）
  "酸碱度": "PH",
  "二氧化碳分压": "PCO2",
  "氧分压": "PO2",
  "钠离子浓度": "NA+",
  "钾离子浓度": "K+",
  "氯离子浓度": "CL-",
  "钙离子浓度": "CA++",
  "酸碱度为 7.4 时的钙离子浓度": "CA++ AT PH 7.4",
  "渗透压": "POP",
  "血氧饱和度": "SO2 EST", "氧饱和度": "SO2",
  "总血红蛋白": "HGB",   // tHb est 跟血常规 HGB 是同一指标的两种测法，统一归 HGB
  "乳酸": "LAC",
  "氢离子浓度": "CH+",
  "实际碳酸氢根": "HCO3-ACT", "碳酸氢根": "HCO3",
  "细胞外液剩余碱": "BE ECF", "碱剩余": "BE",
  "阴离子间隙": "ANGAP",

  // §6 尿常规
  "尿比重": "USG", "比重": "USG",
  "酮体": "KET",
  "尿胆原": "URO",
  "胆红素": "BIL",
  "亚硝酸盐": "NIT",

  // §7 UPC
  "尿蛋白肌酐比": "UPC", "尿液微量蛋白": "UPC",
  "尿蛋白": "UPRO", "尿肌酐": "UCRE",

  // §9 凝血
  "部分活化凝血酶原时间": "APTT",
  "全血凝血酶原时间": "PT",
  "全血凝血原时间": "PT",   // PDF 实测常缺"酶"字
  "凝血酶原时间": "PT",
  "纤维蛋白原": "FIB",
  "凝血酶时间": "TT",

  // §11 胸腹水
  "有核细胞数": "TCC",

  // §12 心肌标志物
  "猫心肌肌钙蛋白": "F-CTNI",

  // §13 传染病
  "猫瘟抗体": "FPV AB",
  "猫杯状抗体": "FCV AB",
  "猫疱疹抗体": "FHV AB",
  "猫艾滋": "FIV", "猫白血病": "FELV",
};

/**
 * 英文缩写别名 → 字典标准 code。
 * PDF 实测会出现各种长短写法（MONO/MON/单核细胞、BASO/BAS、NEUT/NEU、LYMPH/LYM 等），
 * 必须统一到字典标准才能合并同类项。
 */
const EN_CODE_ALIAS_MAP: Record<string, string> = {
  // 血常规分类细胞
  MONO: "MON", MONOS: "MON", MONOCYTE: "MON",
  BASO: "BAS", BASOS: "BAS", BASOPHIL: "BAS",
  NEUT: "NEU", NEUTS: "NEU", NEUTROPHIL: "NEU",
  EOSI: "EOS", EOSIN: "EOS", EOSINO: "EOS", EOSINOPHIL: "EOS",
  LYMP: "LYM", LYMPH: "LYM", LYMPHS: "LYM", LYMPHOCYTE: "LYM",
  // 血常规其他常见别名
  RBCS: "RBC",
  WBCS: "WBC",
  PLTS: "PLT", PLATELETS: "PLT",
  HEMOGLOBIN: "HGB", HB: "HGB",
  // 血气仪测的 tHb（total hemoglobin estimated）跟血常规 HGB 是同一指标的两种测法，临床合并归 HGB
  THB: "HGB", THBEST: "HGB",
  HEMATOCRIT: "HCT",
  // 生化常见别名
  CREATININE: "CREA", CRE: "CREA",
  UREA: "BUN",
  PHOSPHORUS: "PHOS", PHOSPHATE: "PHOS",
  P: "PHOS", IP: "PHOS",  // 字典里 PHOS/P/IP 都是磷
  CALCIUM: "CA",
  ALBUMIN: "ALB",
  GLOBULIN: "GLOB",
  ALP: "ALKP",
  GLUCOSE: "GLU",
  CHOLESTEROL: "CHOL",
  AMYL: "AMYL", AMYLASE: "AMYL",
  LIPASE: "LIPA",
  // 网织红
  RETICULOCYTE: "RETIC", RET: "RETIC",
  // 尿检 PRO（蛋白质 PRO 是尿蛋白 UPRO 的字典缩写）
  PRO: "UPRO",
};

/**
 * 应用英文别名映射：MONO → MON、BASO → BAS 等。
 * 输入应该是已大写后的纯英文（无 %）。
 */
function applyEnAlias(code: string): string {
  return EN_CODE_ALIAS_MAP[code] || code;
}

/**
 * 从「中文（英文 code）」格式抽出英文 code。
 *
 * 用途：DeepSeek/豆包常把"磷（PHOS）"、"酮体（KET）"、"网织红细胞数量（RETIC）"这种
 * 中英混合串直接写进 code 字段，导致 normalize 不到字典。这里直接抽括号里的英文。
 *
 * 命中例：磷（PHOS）→ PHOS、酮体(KET) → KET、网织红细胞数量（RETIC）→ RETIC、钙（Ca）→ Ca
 * 不命中：磷、（PHOS）、PHOS（保留原样让后续步骤处理）
 */
function extractCodeFromBrackets(s: string): string | null {
  if (!s) return null;
  // 必须有中文前缀 + 括号 + 英文（带 +/-/%/. /数字也允许）
  const m = s.match(/[一-龥][^()（）]*[(（]\s*([A-Za-z][A-Za-z0-9/+\-%.]*)\s*[)）]/);
  if (m) return m[1];
  return null;
}

/**
 * 把 "%LYM"、"% NEU"、"NEU %"、"%MONO" 等百分号写法统一为字典标准 "LYM%" / "NEU%" / "MON%"。
 */
function normalizePercentForm(s: string): string {
  const trimmed = s.trim();
  // %LYM、% LYM、％LYM、%MONO、%BASO → LYM% / MON% / BAS%
  const prefixMatch = trimmed.match(/^[%％]\s*([A-Za-z][A-Za-z0-9]*)$/);
  if (prefixMatch) {
    const base = applyEnAlias(prefixMatch[1].toUpperCase());
    return base + "%";
  }
  // LYM %、LYM％、MONO% → LYM% / MON%
  const suffixMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*[%％]$/);
  if (suffixMatch) {
    const base = applyEnAlias(suffixMatch[1].toUpperCase());
    return base + "%";
  }
  return trimmed;
}

/**
 * 中文 fuzzy 兜底：字典命不中 + 后缀 strip 也命不中时，按关键词 regex 猜测标准 code。
 * 例："嗜碱细胞"（字典里只有"嗜碱细胞数目"/"嗜碱性粒细胞"）→ BAS
 *     "红细胞分布宽度变异系数（RDW-CV）"嵌入括号 → RDW-CV
 *
 * 写法约定：判断是否含"百分比 / 比率 / %"来决定是否后缀 %。
 */
function fuzzyMatchChineseName(name: string): string | null {
  if (!name) return null;
  const isPercent = /(%|％|百分比|比率)/.test(name);

  // ===== 血常规 =====
  // 注意顺序：先具体后通用，避免"红细胞分布宽度"被"红细胞"先抢
  if (/红细胞分布宽度/.test(name)) {
    if (/变异/.test(name)) return "RDW-CV";
    if (/标准差/.test(name)) return "RDW-SD";
    return "RDW";
  }
  if (/红细胞压积|红细胞比容|血细胞比容/.test(name)) return "HCT";
  if (/平均红细胞体积/.test(name)) return "MCV";
  if (/平均血红蛋白浓度/.test(name)) return "MCHC";
  if (/平均血红蛋白量/.test(name)) return "MCH";
  if (/血红蛋白/.test(name)) return "HGB";
  if (/血小板分布宽度/.test(name)) return "PDW";
  if (/平均血小板体积|平均小板体积/.test(name)) return "MPV";
  if (/血小板压积/.test(name)) return "PCT";
  if (/血小板/.test(name)) return "PLT";
  if (/网织红细胞/.test(name)) return isPercent ? "RETIC%" : "RETIC";
  if (/红细胞/.test(name)) return "RBC"; // 已排除"红细胞压积/分布宽度"
  if (/白细胞/.test(name)) return "WBC";
  if (/嗜碱/.test(name)) return isPercent ? "BAS%" : "BAS";
  if (/嗜酸/.test(name)) return isPercent ? "EOS%" : "EOS";
  if (/中性/.test(name)) return isPercent ? "NEU%" : "NEU";
  if (/淋巴/.test(name)) return isPercent ? "LYM%" : "LYM";
  if (/单核/.test(name)) return isPercent ? "MON%" : "MON";

  // ===== 生化 =====
  if (/尿素氮.*肌酐.*比|BUN.*CREA/.test(name)) return "BUN/CREA";
  if (/白蛋白.*球蛋白.*比/.test(name)) return "ALB/GLOB";
  if (/肌酐/.test(name)) return "CREA";
  if (/尿素氮|尿素/.test(name)) return "BUN";
  if (/无机磷|血磷|^磷$/.test(name)) return "PHOS";
  if (/总胆红素/.test(name)) return "TBIL";
  if (/直接胆红素/.test(name)) return "DBIL";
  if (/间接胆红素/.test(name)) return "IBIL";
  if (/白蛋白/.test(name)) return "ALB";
  if (/球蛋白/.test(name)) return "GLOB";
  if (/总蛋白/.test(name)) return "TP";
  if (/丙氨酸|谷丙转氨酶|谷丙/.test(name)) return "ALT";
  if (/天门冬|天冬氨酸|谷草转氨酶|谷草/.test(name)) return "AST";
  if (/碱性磷酸酶/.test(name)) return "ALKP";
  if (/谷氨酰/.test(name)) return "GGT";
  if (/血糖|葡萄糖/.test(name)) return "GLU";
  if (/总胆固醇|胆固醇/.test(name)) return "CHOL";
  if (/淀粉酶/.test(name)) return "AMYL";
  if (/脂肪酶/.test(name)) return "LIPA";

  // ===== 血气专属（含离子）=====
  if (/钠离子/.test(name)) return "NA+";
  if (/钾离子/.test(name)) return "K+";
  if (/氯离子/.test(name)) return "CL-";
  if (/钙离子/.test(name)) return "CA++";
  if (/氢离子/.test(name)) return "CH+";
  if (/^钙$|总钙|血钙/.test(name)) return "CA";
  if (/^钠$|血钠/.test(name)) return "NA";
  if (/^钾$|血钾/.test(name)) return "K";
  if (/^氯$|血氯/.test(name)) return "CL";
  if (/二氧化碳分压/.test(name)) return "PCO2";
  if (/氧分压/.test(name)) return "PO2";
  if (/酸碱度/.test(name)) return "PH";
  if (/碳酸氢|HCO3/.test(name)) return "HCO3";
  if (/碱剩余|剩余碱/.test(name)) return "BE";
  if (/乳酸/.test(name)) return "LAC";
  if (/氧饱和度|血氧饱和/.test(name)) return "SO2";
  if (/总血红蛋白/.test(name)) return "HGB";
  if (/阴离子间隙/.test(name)) return "ANGAP";
  if (/渗透压/.test(name)) return "POP";

  // ===== 尿检 =====
  if (/尿比重/.test(name)) return "USG";
  if (/尿蛋白.*肌酐.*比|尿液微量蛋白/.test(name)) return "UPC";
  if (/尿蛋白/.test(name)) return "UPRO";
  if (/尿胆原/.test(name)) return "URO";
  if (/酮体/.test(name)) return "KET";
  if (/隐血/.test(name)) return "BLD";
  if (/亚硝酸盐/.test(name)) return "NIT";

  // ===== 凝血 =====
  if (/部分活化凝血酶原时间/.test(name)) return "APTT";
  if (/全血凝血酶原时间|凝血酶原时间/.test(name)) return "PT";
  if (/纤维蛋白原/.test(name)) return "FIB";
  if (/凝血酶时间/.test(name)) return "TT";

  // ===== 传染病 =====
  if (/猫瘟抗体|FPV/i.test(name)) return "FPV AB";
  if (/猫杯状抗体|FCV/i.test(name)) return "FCV AB";
  if (/猫疱疹抗体|FHV/i.test(name)) return "FHV AB";

  return null;
}

/**
 * 重名 code 的 group 上下文区分：
 *   PH 在血气和尿都有 → 尿归 PH-U，避免合并到血气 PH
 *   HCT/GLU 同理
 */
function disambiguateByGroup(code: string, rawGroup: any): string {
  const g = String(rawGroup || "").toLowerCase();
  if (!code || !g) return code;
  // pH 在尿检 group 下归 PH-U
  if (code === "PH" && /尿/.test(g)) return "PH-U";
  // 葡萄糖：尿糖 vs 血糖（血糖只一种来源不冲突，但尿糖要区分）
  if (code === "GLU" && /尿/.test(g)) return "GLU-U";
  return code;
}

/**
 * 把 PDF 上写的指标名 normalize 成标准英文 code。
 * 决策顺序：中文字典 → strip 后缀字典 → fuzzy 兜底 → 百分号规范化 → 英文 code + 别名 → 退化。
 *
 * @param rawCode PDF 上写的 code 字段（如 "WBC"、"%LYM"、"MONO"）
 * @param rawName PDF 上写的中文名（如 "白细胞数目"、"嗜碱细胞"）
 * @param rawGroup（可选）PDF 上写的检测分组（如 "尿常规"、"血气分析"），用于区分重名 code
 */
export function normalizeLabCode(rawCode: any, rawName: any, rawGroup?: any): string {
  const result = normalizeLabCodeInner(rawCode, rawName);
  return disambiguateByGroup(result, rawGroup);
}

function normalizeLabCodeInner(rawCode: any, rawName: any): string {
  const name = String(rawName || "").trim();
  const codeRaw = String(rawCode || "").trim();

  // 0) 「中文（英文 code）」混合串 → 抽出英文 code（如 "磷（PHOS）" → PHOS）
  //    PDF 解析常把整串塞进 code 或 name 字段，必须在所有字典查询前先抽。
  const extracted = extractCodeFromBrackets(codeRaw) || extractCodeFromBrackets(name);
  if (extracted) {
    let upper = extracted.toUpperCase();
    // 抽出后处理 #/% 后缀
    if (upper.endsWith("#")) upper = upper.slice(0, -1); // 计数 RETIC# → RETIC
    if (upper.endsWith("%")) {
      return applyEnAlias(upper.slice(0, -1)) + "%";
    }
    return applyEnAlias(upper);
  }

  // 1) 中文 name 直接命中字典
  if (name in NAME_TO_CODE_MAP) return NAME_TO_CODE_MAP[name];

  // 2) 别称：去掉常见后缀再查（"白细胞计数" → "白细胞"）
  const stripped = name.replace(/(计数|数目|总数|绝对值|含量|浓度|比率|百分比)$/u, "");
  if (stripped !== name && stripped in NAME_TO_CODE_MAP) {
    const mapped = NAME_TO_CODE_MAP[stripped];
    if (/(比率|百分比)$/u.test(name)) return mapped.endsWith("%") ? mapped : `${mapped}%`;
    return mapped;
  }

  // 2.5) 中文 fuzzy 兜底
  const fuzzy = fuzzyMatchChineseName(name);
  if (fuzzy) return fuzzy;

  // 3) 百分号位置统一
  const percentNormalizedCode = normalizePercentForm(codeRaw);
  if (percentNormalizedCode && /^[A-Z][A-Z0-9]*%$/.test(percentNormalizedCode)) {
    return percentNormalizedCode;
  }
  const percentNormalizedName = normalizePercentForm(name);
  if (percentNormalizedName && /^[A-Z][A-Z0-9]*%$/.test(percentNormalizedName)) {
    return percentNormalizedName;
  }

  // 4) PDF 英文 code → 大写 + 别名映射（允许 # 计数后缀）
  if (codeRaw && /^[A-Za-z][\w/+\-%.#]*$/.test(codeRaw)) {
    let upper = codeRaw.toUpperCase();
    // # 是计数后缀（RETIC# / NEU# / LYM# 等），归一到无 #
    if (upper.endsWith("#")) upper = upper.slice(0, -1);
    if (upper.endsWith("%")) {
      const base = upper.slice(0, -1);
      return applyEnAlias(base) + "%";
    }
    return applyEnAlias(upper);
  }

  // 5) 退化
  const fallback = (codeRaw || name).toUpperCase();
  return applyEnAlias(fallback);
}

/**
 * 判断是否为生命体征 / 体格检查项（应从化验指标中排除）。
 */
export function isVitalSign(rawCode: any, rawName: any): boolean {
  const code = String(rawCode || "").trim().toUpperCase();
  const name = String(rawName || "").trim();
  if (VITAL_SIGNS_CODES.has(code)) return true;
  if (VITAL_SIGNS_CODES.has(name)) return true;
  return false;
}

/**
 * 由 code 判分类。注意有重名（Hct/GLU/pH 在多个组），所以只兜底用，优先用 group。
 */
export function resolveCategoryByCode(code: string): string | null {
  const upper = String(code || "").trim().toUpperCase();
  if (!upper) return null;

  // 优先专属（非重名）的 code 集合
  if (INFECTIOUS_CODES.has(upper)) return "传染病";
  if (OTHER_CODES.has(upper)) return "其他";
  if (URINE_CODES.has(upper) || URINE_CODES.has(code)) return "尿检";
  if (BLOOD_ROUTINE_CODES.has(upper)) return "血常规";
  if (BLOOD_GAS_CODES.has(upper)) return "血气";
  if (BIOCHEMISTRY_CODES.has(upper)) return "生化";
  return null;
}

/**
 * 强制分类：只覆盖"绝对专属、不重名"的 code（OTHER/INFECTIOUS/URINE 中的部分）。
 * 用途：解决 PDF group 字段写错（如 RETIC 被 DeepSeek 错归到"生化"组）的问题。
 * 这里 code 的归属是字典硬规定的，PDF group 写错也要纠正回来。
 */
export function forceCategoryByCode(code: string): string | null {
  const upper = String(code || "").trim().toUpperCase();
  if (!upper) return null;
  if (INFECTIOUS_CODES.has(upper)) return "传染病";
  if (OTHER_CODES.has(upper)) return "其他"; // RETIC/PT/APTT/FIB/TT/血型/TCC/F-CTNI 等
  // URINE_CODES 不强制（USG 等专属字符可强制，但 pH/GLU 跟血气重名靠 group）
  // —— 只对绝对专属的尿 code 强制
  if (URINE_SPECIFIC_CODES.has(upper)) return "尿检";
  // HGB / HCT 即使 PDF 标在"血气分析"组里，临床本质也是血常规指标，强制归血常规
  if (BLOOD_ROUTINE_FORCE_CODES.has(upper)) return "血常规";
  return null;
}

// 血常规强制 code：HGB / HCT 即使被 PDF 标在血气组（血气仪测出的 tHb/Hct），归类还是血常规
const BLOOD_ROUTINE_FORCE_CODES = new Set(["HGB", "HCT"]);

// 尿检专属 code（不与其他组重名的）
const URINE_SPECIFIC_CODES = new Set([
  "USG", "KET", "URO", "NIT", "UPC", "UPRO", "U-PRO", "UCRE", "U-CRE", "U-PCR",
  "BLD", "隐血", "隐血-溶血", "隐血-非溶血", "采样方式", "颜色", "透明度", "镜检", "镜检图", "染色图",
  "PH-U",
]);

export { mapGroupNameToCategory };

/**
 * 兜底分类（无 group 也无 code 命中时根据 name/group 文字 regex 猜）。
 */
export function normalizeTrendCheckCategory(input: {
  code?: any;
  type?: any;
  name?: any;
  group?: any;
  system?: any;
  examType?: any;
} = {}) {
  const code = String(input.code || input.type || "").trim().toUpperCase();
  const text = [input.group, input.system, input.name, input.examType]
    .filter(Boolean)
    .map((x: any) => String(x).trim())
    .join(" ")
    .toLowerCase();

  // 影像类直接归 B超/心超
  if (IMAGING_KEYWORDS_REGEX.test(text)) return "B超/心超";

  // 字典里的 group 名字
  const byGroup = mapGroupNameToCategory(text);
  if (byGroup) return byGroup;

  // code 白名单
  const byCode = resolveCategoryByCode(code);
  if (byCode) return byCode;

  return "其他";
}
