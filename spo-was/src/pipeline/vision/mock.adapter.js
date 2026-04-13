const path = require("path");

const guessRoleByPage = (pageNumber) => {
  if (pageNumber === 1) return "cover";
  if (pageNumber === 2) return "agenda";
  if (pageNumber % 5 === 0) return "comparison";
  if (pageNumber % 7 === 0) return "conclusion";
  if (pageNumber % 9 === 0) return "references";
  return "content";
};

const buildMockPageAnalysis = ({ pageNumber, imagePath }) => {
  const role = guessRoleByPage(pageNumber);
  const baseName = path.basename(imagePath, path.extname(imagePath));
  const title = role === "cover" ? "발표 개요" : `${baseName} 핵심 포인트`;

  return {
    page_number: pageNumber,
    slide_role: role,
    title,
    main_points:
      role === "cover"
        ? ["문서의 주제와 배경 소개", "발표 맥락 정리"]
        : ["핵심 개념 설명", "적용 시나리오 제시", "운영 고려사항 언급"],
    keywords: ["핵심개념", "적용", "리스크", "운영"],
    facts: ["페이지에서 확인 가능한 항목 중심으로 정리"],
    interpretations: ["문서 흐름상 실무 적용을 강조하는 구성으로 보임"],
    discussion_candidates: [
      "핵심 개념을 실제 운영에 적용할 때 우선순위는 무엇인가?",
      "리스크를 줄이기 위해 팀이 합의해야 할 기준은 무엇인가?",
    ],
    confidence: role === "content" ? 0.78 : 0.64,
    used_ocr: false,
    signals: {
      small_text_likelihood: role === "comparison" ? 0.72 : 0.35,
      scan_quality: "normal",
    },
  };
};

const createMockVisionAdapter = () => ({
  provider: "mock",
  model: "mock-vision-v1",
  async analyzePage(input) {
    return buildMockPageAnalysis(input);
  },
  async summarizeDocument(payload) {
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    const contentPages = pages.filter((page) => page.slide_role !== "references" && page.slide_role !== "cover");
    const allKeywords = contentPages.flatMap((page) => page.keywords || []);
    const topKeyword = allKeywords[0] || "수업 핵심 개념";

    return {
      document_theme: `${topKeyword} 중심의 수업 복습 자료`,
      section_flow: [
        {
          section: "도입",
          slide_roles: ["cover", "agenda"],
          page_range: "1-2",
          focus: "문서 목적과 학습 흐름 소개",
        },
        {
          section: "핵심 내용",
          slide_roles: ["content", "comparison"],
          page_range: `3-${Math.max(3, pages.length - 1)}`,
          focus: "핵심 개념과 적용/비교 포인트",
        },
      ],
      recurring_axes: ["개념 정의", "적용 조건", "운영 리스크"],
      comparison_axes: ["대안 비교", "장단점 비교"],
      value_conflicts: ["속도 vs 안정성", "비용 vs 품질"],
      safe_discussion_zones: [
        "적용 우선순위와 검증 기준",
        "비교 관점에서의 의사결정 기준",
        "운영 리스크 완화 전략",
      ],
      excluded_pages: pages
        .filter((page) => page.slide_role === "cover" || page.slide_role === "references")
        .map((page) => ({
          page_number: page.page_number,
          reason: page.slide_role === "cover" ? "cover_page" : "reference_like",
        })),
    };
  },
  async generateTopics(payload) {
    const summary = payload?.summary || {};
    const zones = Array.isArray(summary.safe_discussion_zones) ? summary.safe_discussion_zones : [];
    const base = zones[0] || "핵심 개념";

    return {
      document_theme: summary.document_theme || "수업 복습",
      topics: [
        { id: 1, type: "pro_con", topic: `${base}을 우선 적용하는 전략은 실무에서 타당한가?`, rationale: "적용 우선순위 판단", evidence_pages: [3] },
        { id: 2, type: "pro_con", topic: `${base}을 보수적으로 적용해야 한다는 주장에 동의하는가?`, rationale: "리스크 기반 판단", evidence_pages: [4] },
        { id: 3, type: "comparison", topic: "두 가지 구현 접근 중 운영 안정성이 더 높은 선택은 무엇인가?", rationale: "대안 비교", evidence_pages: [5] },
        { id: 4, type: "comparison", topic: "성능 중심 설계와 유지보수 중심 설계 중 팀 상황에 맞는 선택은 무엇인가?", rationale: "상황별 비교", evidence_pages: [6] },
        { id: 5, type: "value_judgment", topic: "기술 부채를 감수하고 출시 속도를 높이는 결정은 언제 정당화될 수 있는가?", rationale: "가치 충돌 토론", evidence_pages: [7] },
        { id: 6, type: "value_judgment", topic: "사용자 경험과 내부 운영 비용이 충돌할 때 어떤 원칙으로 결정해야 하는가?", rationale: "의사결정 기준", evidence_pages: [8] },
        { id: 7, type: "current_relevance", topic: "오늘 수업 내용을 현재 팀 프로젝트에 적용하면 가장 먼저 개선할 부분은 무엇인가?", rationale: "현재적 적용", evidence_pages: [3, 4] },
        { id: 8, type: "current_relevance", topic: "현재 서비스 장애 패턴을 줄이기 위해 수업 개념을 어떻게 운영 규칙으로 바꿀 수 있는가?", rationale: "실전 연결", evidence_pages: [5, 6] },
        { id: 9, type: "comparison", topic: "사전 검증 강화와 사후 모니터링 강화 중 현재 조직에 더 효과적인 전략은 무엇인가?", rationale: "전략 비교", evidence_pages: [6, 7] },
        { id: 10, type: "current_relevance", topic: "이번 주 학습 계획에 반영할 수 있는 가장 작은 실천 단위는 무엇인가?", rationale: "행동 전환", evidence_pages: [2, 3] },
      ],
    };
  },
});

module.exports = {
  createMockVisionAdapter,
};
