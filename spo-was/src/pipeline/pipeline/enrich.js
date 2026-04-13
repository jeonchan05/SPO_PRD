const extractKeywords = (text, limit = 10) => {
  const stopWords = new Set(["그리고", "하지만", "또한", "이번", "수업", "자료", "발표", "the", "and", "for", "with"]);
  const tokens = String(text || "")
    .toLowerCase()
    .match(/[a-zA-Z가-힣][a-zA-Z가-힣0-9_-]{1,}/g);

  if (!tokens) return [];

  const freq = new Map();
  tokens.forEach((token) => {
    if (stopWords.has(token)) return;
    freq.set(token, (freq.get(token) || 0) + 1);
  });

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
};

const extractFactLikeLines = (text, limit = 6) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.filter((line) => /\d|%|증가|감소|이상|이하|vs|비교|성능|비용|지연/i.test(line)).slice(0, limit);
};

const toOneSentence = (value) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?。！？])\s+/)[0] || text;
  return sentence.slice(0, 120).trim();
};

const enrichWithOcr = (pageAnalysis, ocrText, ocrReason = "") => {
  const lines = String(ocrText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4);

  const enriched = {
    ...pageAnalysis,
    used_ocr: true,
    ocr_reason: ocrReason || "fallback",
  };

  if (!enriched.title && lines[0]) {
    enriched.title = toOneSentence(lines[0]);
  }

  const ocrPoints = lines.slice(0, 3).map(toOneSentence).filter(Boolean);
  if (!Array.isArray(enriched.main_points) || enriched.main_points.length === 0) {
    enriched.main_points = ocrPoints;
  } else {
    enriched.main_points = Array.from(new Set([...enriched.main_points, ...ocrPoints])).slice(0, 3);
  }

  const factLines = extractFactLikeLines(ocrText, 6);
  enriched.facts = Array.from(new Set([...(enriched.facts || []), ...factLines])).slice(0, 8);

  const keywords = extractKeywords(ocrText, 12);
  enriched.keywords = Array.from(new Set([...(enriched.keywords || []), ...keywords])).slice(0, 12);

  if (!Array.isArray(enriched.discussion_candidates) || enriched.discussion_candidates.length === 0) {
    const base = enriched.main_points[0] || enriched.title || "핵심 개념";
    enriched.discussion_candidates = [
      `${base}를 실제 적용할 때 가장 먼저 검증해야 할 기준은 무엇인가?`,
      `${base}의 장점과 한계를 동시에 고려하면 어떤 의사결정이 가능한가?`,
    ].slice(0, 2);
  }

  const confidence = Number(enriched.confidence || 0);
  enriched.confidence = Math.max(confidence, Math.min(0.95, confidence + 0.18));

  return enriched;
};

module.exports = {
  enrichWithOcr,
  extractKeywords,
  extractFactLikeLines,
  toOneSentence,
};
