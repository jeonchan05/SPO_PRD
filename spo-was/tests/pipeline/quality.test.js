const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deduplicateTopics,
  buildExcludedPages,
  postProcessTopics,
} = require("../../src/pipeline/pipeline/heuristics");
const { shouldTriggerOcrFallback } = require("../../src/pipeline/pipeline/fallback");

test("duplicate topic removal", () => {
  const input = [
    { id: 1, type: "comparison", topic: "A와 B 중 어떤 전략이 더 효율적인가?", rationale: "비교", evidence_pages: [1] },
    { id: 2, type: "comparison", topic: "A와 B 중 어떤 전략이 더 효율적인가", rationale: "비교", evidence_pages: [1] },
    { id: 3, type: "pro_con", topic: "A 전략을 우선 적용해야 하는가?", rationale: "찬반", evidence_pages: [2] },
  ];

  const deduped = deduplicateTopics(input);
  assert.equal(deduped.length, 2);
});

test("fallback OCR trigger rule", () => {
  const decision = shouldTriggerOcrFallback(
    {
      page_number: 3,
      slide_role: "other",
      title: "",
      main_points: [],
      keywords: [],
      facts: [],
      interpretations: [],
      discussion_candidates: [],
      confidence: 0.31,
      used_ocr: false,
      signals: { small_text_likelihood: 0.81 },
    },
    {
      minConfidence: 0.62,
      minVisibleTextChars: 20,
    },
  );

  assert.equal(decision.shouldUseOcr, true);
  assert.ok(decision.reasons.includes("small_text_likelihood_high"));
  assert.ok(decision.reasons.some((reason) => reason.startsWith("low_confidence")));
});

test("excluded pages filtering", () => {
  const pages = [
    { page_number: 1, slide_role: "cover", title: "발표 제목" },
    { page_number: 2, slide_role: "content", title: "핵심 내용" },
    { page_number: 3, slide_role: "references", title: "참고문헌" },
    { page_number: 4, slide_role: "content", title: "Thank you" },
  ];

  const excluded = buildExcludedPages(pages);
  assert.deepEqual(
    excluded.map((item) => item.page_number),
    [1, 3, 4],
  );
});

test("postProcessTopics ensures 10 topics", () => {
  const summary = {
    document_theme: "인증 운영",
    recurring_axes: ["안정성", "성능"],
    comparison_axes: ["세션 vs 토큰"],
    value_conflicts: ["속도 vs 안정성"],
    safe_discussion_zones: ["재발급 정책", "장애 대응"],
  };

  const processed = postProcessTopics(
    [
      { id: 1, type: "comparison", topic: "세션과 토큰 방식 중 유지보수성이 더 높은 것은 무엇인가?", rationale: "비교", evidence_pages: [2] },
      { id: 2, type: "comparison", topic: "세션과 토큰 방식 중 유지보수성이 더 높은 것은 무엇인가", rationale: "비교", evidence_pages: [2] },
    ],
    summary,
  );

  assert.equal(processed.length, 10);
});
