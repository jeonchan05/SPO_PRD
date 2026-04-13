const SLIDE_ROLE_SET = new Set([
  "cover",
  "agenda",
  "content",
  "comparison",
  "conclusion",
  "references",
  "other",
]);

const TOPIC_TYPE_SET = new Set(["pro_con", "comparison", "value_judgment", "current_relevance"]);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

const normalizeArray = (value, limit = 10) => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
  return Array.from(new Set(normalized));
};

const parseJsonFromText = (raw) => {
  const text = String(raw || "").trim();
  if (!text) throw new Error("빈 응답입니다.");

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch (_error) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("JSON 파싱에 실패했습니다.");
  }
};

const normalizePageAnalysis = (value, pageNumber) => {
  const safePageNumber = Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : Number(value?.page_number || 0);
  const role = SLIDE_ROLE_SET.has(String(value?.slide_role || "")) ? String(value.slide_role) : "other";

  const normalized = {
    page_number: safePageNumber,
    slide_role: role,
    title: String(value?.title || "").trim(),
    main_points: normalizeArray(value?.main_points, 3),
    keywords: normalizeArray(value?.keywords, 12),
    facts: normalizeArray(value?.facts, 8),
    interpretations: normalizeArray(value?.interpretations, 8),
    discussion_candidates: normalizeArray(value?.discussion_candidates, 2),
    confidence: Math.max(0, Math.min(1, Number(value?.confidence || 0))),
    used_ocr: Boolean(value?.used_ocr),
  };

  const ocrReason = String(value?.ocr_reason || "").trim();
  if (ocrReason) normalized.ocr_reason = ocrReason;

  if (value?.signals && typeof value.signals === "object") {
    normalized.signals = value.signals;
  }

  return normalized;
};

const validatePageAnalysis = (value) => {
  const errors = [];

  if (!Number.isInteger(value?.page_number) || value.page_number <= 0) {
    errors.push("page_number는 1 이상의 정수여야 합니다.");
  }
  if (!SLIDE_ROLE_SET.has(String(value?.slide_role || ""))) {
    errors.push("slide_role 값이 유효하지 않습니다.");
  }
  if (typeof value?.title !== "string") {
    errors.push("title은 문자열이어야 합니다.");
  }
  if (!isStringArray(value?.main_points)) {
    errors.push("main_points는 문자열 배열이어야 합니다.");
  }
  if (!isStringArray(value?.keywords)) {
    errors.push("keywords는 문자열 배열이어야 합니다.");
  }
  if (!isStringArray(value?.facts)) {
    errors.push("facts는 문자열 배열이어야 합니다.");
  }
  if (!isStringArray(value?.interpretations)) {
    errors.push("interpretations는 문자열 배열이어야 합니다.");
  }
  if (!isStringArray(value?.discussion_candidates)) {
    errors.push("discussion_candidates는 문자열 배열이어야 합니다.");
  }
  if (typeof value?.confidence !== "number" || Number.isNaN(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push("confidence는 0~1 범위 숫자여야 합니다.");
  }
  if (typeof value?.used_ocr !== "boolean") {
    errors.push("used_ocr는 boolean이어야 합니다.");
  }
  if (value?.ocr_reason != null && typeof value.ocr_reason !== "string") {
    errors.push("ocr_reason은 문자열이어야 합니다.");
  }

  return { valid: errors.length === 0, errors };
};

const normalizeDocumentSummary = (value, fallbackExcludedPages = []) => ({
  document_theme: String(value?.document_theme || "").trim(),
  section_flow: Array.isArray(value?.section_flow)
    ? value.section_flow
        .map((item) => ({
          section: String(item?.section || "").trim(),
          slide_roles: normalizeArray(item?.slide_roles, 6),
          page_range: String(item?.page_range || "").trim(),
          focus: String(item?.focus || "").trim(),
        }))
        .filter((item) => item.section)
    : [],
  recurring_axes: normalizeArray(value?.recurring_axes, 12),
  comparison_axes: normalizeArray(value?.comparison_axes, 12),
  value_conflicts: normalizeArray(value?.value_conflicts, 12),
  safe_discussion_zones: normalizeArray(value?.safe_discussion_zones, 12),
  excluded_pages: Array.isArray(value?.excluded_pages)
    ? value.excluded_pages
        .map((item) => ({
          page_number: Number(item?.page_number || 0),
          reason: String(item?.reason || "").trim(),
        }))
        .filter((item) => Number.isInteger(item.page_number) && item.page_number > 0 && item.reason)
    : fallbackExcludedPages,
});

const validateDocumentSummary = (value) => {
  const errors = [];
  if (!isNonEmptyString(value?.document_theme)) {
    errors.push("document_theme은 비어있지 않은 문자열이어야 합니다.");
  }

  if (!Array.isArray(value?.section_flow)) {
    errors.push("section_flow는 배열이어야 합니다.");
  }

  ["recurring_axes", "comparison_axes", "value_conflicts", "safe_discussion_zones"].forEach((key) => {
    if (!isStringArray(value?.[key])) {
      errors.push(`${key}는 문자열 배열이어야 합니다.`);
    }
  });

  if (!Array.isArray(value?.excluded_pages)) {
    errors.push("excluded_pages는 배열이어야 합니다.");
  } else {
    value.excluded_pages.forEach((item, index) => {
      if (!Number.isInteger(item?.page_number) || item.page_number <= 0) {
        errors.push(`excluded_pages[${index}].page_number가 유효하지 않습니다.`);
      }
      if (!isNonEmptyString(item?.reason)) {
        errors.push(`excluded_pages[${index}].reason이 비어 있습니다.`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
};

const normalizeDiscussionTopics = (value) => ({
  document_theme: String(value?.document_theme || "").trim(),
  topics: Array.isArray(value?.topics)
    ? value.topics.map((item, index) => ({
        id: Number.isInteger(item?.id) && item.id > 0 ? item.id : index + 1,
        type: TOPIC_TYPE_SET.has(String(item?.type || "")) ? String(item.type) : "comparison",
        topic: String(item?.topic || "").replace(/\s+/g, " ").trim(),
        rationale: String(item?.rationale || "").replace(/\s+/g, " ").trim(),
        evidence_pages: Array.isArray(item?.evidence_pages)
          ? item.evidence_pages
              .map((page) => Number(page))
              .filter((page) => Number.isInteger(page) && page > 0)
              .slice(0, 10)
          : [],
      }))
    : [],
});

const validateDiscussionTopics = (value, expectedCount = 10) => {
  const errors = [];
  if (!isNonEmptyString(value?.document_theme)) {
    errors.push("document_theme은 비어있지 않은 문자열이어야 합니다.");
  }

  if (!Array.isArray(value?.topics)) {
    errors.push("topics는 배열이어야 합니다.");
    return { valid: false, errors };
  }

  if (value.topics.length !== expectedCount) {
    errors.push(`topics 개수는 ${expectedCount}개여야 합니다.`);
  }

  value.topics.forEach((item, index) => {
    if (!TOPIC_TYPE_SET.has(String(item?.type || ""))) {
      errors.push(`topics[${index}].type이 유효하지 않습니다.`);
    }
    if (!isNonEmptyString(item?.topic)) {
      errors.push(`topics[${index}].topic이 비어 있습니다.`);
    }
    if (!isNonEmptyString(item?.rationale)) {
      errors.push(`topics[${index}].rationale이 비어 있습니다.`);
    }
    if (!Array.isArray(item?.evidence_pages) || !item.evidence_pages.every((page) => Number.isInteger(page) && page > 0)) {
      errors.push(`topics[${index}].evidence_pages가 유효하지 않습니다.`);
    }
  });

  return { valid: errors.length === 0, errors };
};

module.exports = {
  SLIDE_ROLE_SET,
  TOPIC_TYPE_SET,
  parseJsonFromText,
  normalizePageAnalysis,
  validatePageAnalysis,
  normalizeDocumentSummary,
  validateDocumentSummary,
  normalizeDiscussionTopics,
  validateDiscussionTopics,
};
