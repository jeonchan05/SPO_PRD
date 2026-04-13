const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePageAnalysis,
  validateDocumentSummary,
  validateDiscussionTopics,
} = require("../../src/pipeline/models/schema");

test("page analysis schema validation", () => {
  const sample = {
    page_number: 1,
    slide_role: "content",
    title: "인증 흐름 개요",
    main_points: ["액세스 토큰 검증", "리프레시 재발급"],
    keywords: ["access token", "refresh token"],
    facts: ["토큰 만료 시간 30분"],
    interpretations: ["재발급 요청 집중 시 병목 가능"],
    discussion_candidates: ["재발급 정책을 어떻게 설계할 것인가?"],
    confidence: 0.86,
    used_ocr: false,
  };

  const result = validatePageAnalysis(sample);
  assert.equal(result.valid, true);
});

test("document summary schema validation", () => {
  const sample = {
    document_theme: "토큰 인증 운영 전략",
    section_flow: [
      { section: "도입", slide_roles: ["cover"], page_range: "1", focus: "문서 개요" },
      { section: "핵심", slide_roles: ["content", "comparison"], page_range: "2-6", focus: "전략 비교" },
    ],
    recurring_axes: ["안정성", "성능"],
    comparison_axes: ["세션 기반 vs 토큰 기반"],
    value_conflicts: ["속도 vs 안정성"],
    safe_discussion_zones: ["토큰 재발급 빈도 최적화"],
    excluded_pages: [{ page_number: 7, reason: "references_role" }],
  };

  const result = validateDocumentSummary(sample);
  assert.equal(result.valid, true);
});

test("discussion topics count=10 validation", () => {
  const sample = {
    document_theme: "토큰 인증 운영 전략",
    topics: Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      type: i % 2 === 0 ? "comparison" : "pro_con",
      topic: `주제 ${i + 1}은 무엇인가?`,
      rationale: "발표자료 근거 기반",
      evidence_pages: [1, 2],
    })),
  };

  const result = validateDiscussionTopics(sample, 10);
  assert.equal(result.valid, true);
});
