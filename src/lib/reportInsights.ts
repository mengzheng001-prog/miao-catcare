function toTimestamp(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatRecordStatus(status: any) {
  switch (String(status || "").toLowerCase()) {
    case "high":
    case "high_warning":
    case "偏高":
      return "偏高";
    case "low":
    case "偏低":
      return "偏低";
    case "negative":
    case "阴性":
      return "阴性";
    case "positive":
    case "阳性":
      return "阳性";
    case "abnormal":
    case "异常":
      return "异常";
    case "normal":
    case "正常":
      return "正常";
    default:
      return String(status || "待确认");
  }
}

export function getConfirmedPdfs(store: any) {
  return [...(store?.pdfs || [])]
    .filter((pdf: any) => pdf.status === "已入库")
    .sort((a: any, b: any) => {
      const left = a.reportDate || a.date || a.uploadTime;
      const right = b.reportDate || b.date || b.uploadTime;
      return toTimestamp(right) - toTimestamp(left);
    });
}

export function isConfirmedOrLegacySource(sourcePdfId: string | undefined, confirmedReportIds: Set<string>) {
  if (sourcePdfId) {
    return confirmedReportIds.has(sourcePdfId);
  }

  return confirmedReportIds.size > 0;
}

export function getConfirmedVisitDrafts(store: any, confirmedReportIds: Set<string>) {
  return Object.values(store?.reportDrafts || {})
    .filter((draft: any) => confirmedReportIds.has((draft as any).reportId))
    .sort((a: any, b: any) => {
      const left = a?.visitInfo?.reportDate || a?.visitInfo?.visitDate;
      const right = b?.visitInfo?.reportDate || b?.visitInfo?.visitDate;
      return toTimestamp(right) - toTimestamp(left);
    });
}

export function getLatestVisitInfo(store: any, confirmedReportIds: Set<string>) {
  return getConfirmedVisitDrafts(store, confirmedReportIds)[0]?.visitInfo || null;
}

export function getConfirmedIndicators(store: any, confirmedReportIds: Set<string>) {
  return (store?.indicators || [])
    .map((indicator: any) => ({
      ...indicator,
      records: [...(indicator.records || [])]
        .filter((record: any) => isConfirmedOrLegacySource(record.sourcePdfId, confirmedReportIds))
        .sort((a: any, b: any) => toTimestamp(a.date || a.reportDate) - toTimestamp(b.date || b.reportDate)),
    }))
    .filter((indicator: any) => indicator.records.length > 0);
}

export function getConfirmedMedications(store: any, confirmedReportIds: Set<string>) {
  return (store?.meds || []).filter((med: any) => isConfirmedOrLegacySource(med.sourcePdfId, confirmedReportIds));
}

export function getConfirmedFollowups(store: any, confirmedReportIds: Set<string>) {
  const confirmedPdfs = getConfirmedPdfs(store);
  const pdfMap = new Map(confirmedPdfs.map((pdf: any) => [pdf.id, pdf]));

  const draftFollowups = getConfirmedVisitDrafts(store, confirmedReportIds).flatMap((draft: any) =>
    (draft.followups || []).map((followup: any, index: number) => {
      const reportId = draft.reportId;
      const sourcePdf = pdfMap.get(reportId);
      return {
        id: followup.id || `${reportId}_followup_${index + 1}`,
        reportId,
        date: followup.date || draft.visitInfo?.reportDate || draft.visitInfo?.visitDate || "",
        title: followup.title || "复查建议",
        desc: followup.desc || draft.visitInfo?.followupText || "",
        items: Array.isArray(followup.items) ? followup.items : [],
        sourcePdfName: sourcePdf?.filename || draft.fileName || "未命名报告.pdf",
        sourcePage: followup.sourcePage || "第5页",
        uploadTime: sourcePdf?.uploadTime,
      };
    })
  );

  const timelineFollowups = (store?.timeline || [])
    .filter((item: any) => item.type === "plan" && isConfirmedOrLegacySource(item.sourcePdfId, confirmedReportIds))
    .map((item: any, index: number) => ({
      id: item.id || `legacy_followup_${index + 1}`,
      reportId: item.sourcePdfId,
      date: item.eventDate || item.date || "",
      title: item.title || "复查建议",
      desc: item.desc || "",
      items: [],
      sourcePdfName: item.sourcePdfName || item.source || "历史复查记录",
      sourcePage: item.sourcePage || "",
      uploadTime: item.uploadTime,
    }));

  const deduped = [...draftFollowups, ...timelineFollowups].reduce((acc: Record<string, any>, followup: any) => {
    const key = [
      followup.reportId || followup.sourcePdfName,
      followup.date || "",
      followup.desc || "",
      followup.sourcePage || "",
    ].join("__");

    if (!acc[key]) {
      acc[key] = followup;
    }
    return acc;
  }, {});

  return Object.values(deduped).sort((a: any, b: any) => {
    return toTimestamp(a.date) - toTimestamp(b.date);
  });
}

export function buildIndicatorNarrative(indicator: any) {
  const latest = indicator?.records?.[indicator.records.length - 1];
  const previous = indicator?.records?.[indicator.records.length - 2];
  const code = indicator?.code || indicator?.name || "指标";

  if (!latest) {
    return `${code} 暂无结构化记录。`;
  }

  const latestStatus = formatRecordStatus(latest.status);
  const valueText = latest.value !== "" && latest.value !== undefined && latest.value !== null ? latest.value : "待确认";
  const unitText = indicator?.unit ? ` ${indicator.unit}` : "";
  const baseText = `${code} 最新结果为 ${valueText}${unitText}，当前状态${latestStatus}`;

  if (Number.isFinite(Number(latest.value)) && Number.isFinite(Number(previous?.value))) {
    const current = Number(latest.value);
    const prev = Number(previous.value);
    if (current > prev) {
      return `${baseText}，较上次上升。`;
    }
    if (current < prev) {
      return `${baseText}，较上次下降。`;
    }
    return `${baseText}，与上次接近。`;
  }

  if (previous) {
    return `${baseText}，请结合前次记录继续观察。`;
  }

  return `${baseText}。`;
}
