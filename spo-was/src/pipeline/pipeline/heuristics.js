const { TOPIC_TYPE_SET } = require("../models/schema");

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const jaccard = (a, b) => {
  const setA = new Set(normalizeText(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;

  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
};

const deduplicateTopics = (topics, similarityThreshold = 0.82) => {
  const unique = [];
  for (const topic of topics || []) {
    const exists = unique.some((existing) => {
      const sameNormalized = normalizeText(existing.topic) === normalizeText(topic.topic);
      const similar = jaccard(existing.topic, topic.topic) >= similarityThreshold;
      return sameNormalized || similar;
    });
    if (!exists) unique.push(topic);
  }
  return unique;
};

const buildExcludedPages = (pages) => {
  const results = [];
  for (const page of pages || []) {
    const role = String(page.slide_role || "other");
    const title = String(page.title || "").toLowerCase();

    if (role === "references") {
      results.push({ page_number: page.page_number, reason: "references_role" });
      continue;
    }
    if (role === "cover") {
      results.push({ page_number: page.page_number, reason: "cover_page" });
      continue;
    }
    if (/thanks|thank you|q&a|참고문헌|감사/.test(title)) {
      results.push({ page_number: page.page_number, reason: "title_based_exclusion" });
    }
  }
  return results;
};

const buildHeuristicDocumentSummary = (pages) => {
  const excludedPages = buildExcludedPages(pages);
  const excludedSet = new Set(excludedPages.map((item) => item.page_number));
  const included = (pages || []).filter((page) => !excludedSet.has(page.page_number));

  const sectionFlow = [];
  let current = null;

  included.forEach((page) => {
    if (!current || current.role !== page.slide_role) {
      if (current) sectionFlow.push(current);
      current = {
        start: page.page_number,
        end: page.page_number,
        role: page.slide_role,
        titles: [String(page.title || "").trim()].filter(Boolean),
      };
    } else {
      current.end = page.page_number;
      if (page.title) current.titles.push(String(page.title).trim());
    }
  });
  if (current) sectionFlow.push(current);

  const keywordFreq = new Map();
  included.forEach((page) => {
    (page.keywords || []).forEach((keyword) => {
      const key = String(keyword || "").trim();
      if (!key) return;
      keywordFreq.set(key, (keywordFreq.get(key) || 0) + 1);
    });
  });

  const recurringAxes = Array.from(keywordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([keyword]) => keyword);

  const comparisonAxes = included
    .filter((page) => page.slide_role === "comparison")
    .flatMap((page) => page.main_points || [])
    .slice(0, 8);

  const valueConflicts = included
    .flatMap((page) => page.interpretations || [])
    .filter((text) => /vs|트레이드오프|균형|충돌|비용|품질|속도|안정/i.test(String(text)))
    .slice(0, 8);

  const safeZones = included
    .flatMap((page) => page.discussion_candidates || [])
    .slice(0, 10);

  const themeSource = included.find((page) => page.title)?.title || recurringAxes[0] || "수업 복습 자료";

  return {
    document_theme: `${themeSource} 중심 토론 자료`,
    section_flow: sectionFlow.map((item, index) => ({
      section: item.titles[0] || `섹션 ${index + 1}`,
      slide_roles: [item.role],
      page_range: item.start === item.end ? `${item.start}` : `${item.start}-${item.end}`,
      focus: item.titles.slice(0, 2).join(" / ") || `${item.role} 전개`,
    })),
    recurring_axes: recurringAxes,
    comparison_axes: comparisonAxes,
    value_conflicts: valueConflicts,
    safe_discussion_zones: safeZones,
    excluded_pages: excludedPages,
  };
};

const ensureTopicDiversity = (topics) => {
  const requiredTypes = ["pro_con", "comparison", "value_judgment", "current_relevance"];
  const targetCounts = new Map([
    ["pro_con", 2],
    ["comparison", 3],
    ["value_judgment", 2],
    ["current_relevance", 3],
  ]);
  const buckets = new Map(requiredTypes.map((type) => [type, []]));

  (topics || []).forEach((topic) => {
    const type = TOPIC_TYPE_SET.has(String(topic.type || "")) ? topic.type : "comparison";
    buckets.get(type).push({ ...topic, type });
  });

  const selected = [];
  requiredTypes.forEach((type) => {
    const target = targetCounts.get(type) || 0;
    for (let i = 0; i < target; i += 1) {
      if (buckets.get(type).length === 0) break;
      selected.push(buckets.get(type).shift());
    }
  });

  const remaining = requiredTypes.flatMap((type) => buckets.get(type));
  for (const topic of remaining) {
    if (selected.length >= 10) break;
    selected.push(topic);
  }

  return selected.slice(0, 10).map((topic, index) => ({ ...topic, id: index + 1 }));
};

const isOutOfScopeTopic = (topicText, summary) => {
  const text = normalizeText(topicText);
  if (!text) return true;

  const summaryTokens = [
    ...(summary.recurring_axes || []),
    ...(summary.comparison_axes || []),
    ...(summary.value_conflicts || []),
    ...(summary.safe_discussion_zones || []),
    summary.document_theme || "",
  ]
    .join(" ")
    .toLowerCase();

  const keywordHits = text
    .split(" ")
    .filter(Boolean)
    .some((token) => token.length >= 2 && summaryTokens.includes(token));

  return !keywordHits;
};

const buildFallbackTopics = (summary) => {
  const axes = Array.from(
    new Set([
      ...(summary.safe_discussion_zones || []),
      ...(summary.comparison_axes || []),
      ...(summary.value_conflicts || []),
      ...(summary.recurring_axes || []),
    ].map((item) => String(item || "").trim()).filter(Boolean)),
  );

  const takeAxis = (index, fallback = "핵심 개념") => axes[index] || fallback;

  return [
    { id: 1, type: "pro_con", topic: `${takeAxis(0)}을 우선 적용하는 전략은 타당한가?`, rationale: "찬반 관점 검증", evidence_pages: [1] },
    { id: 2, type: "pro_con", topic: `${takeAxis(1)}을 보수적으로 제한해야 한다는 주장에 동의하는가?`, rationale: "리스크 기반 찬반", evidence_pages: [2] },
    { id: 3, type: "comparison", topic: `${takeAxis(2)} 관점에서 대안 A와 B 중 더 현실적인 선택은 무엇인가?`, rationale: "대안 비교", evidence_pages: [3] },
    { id: 4, type: "comparison", topic: `${takeAxis(3)}을 기준으로 단기 최적화와 장기 안정화 중 무엇이 우선인가?`, rationale: "시간축 비교", evidence_pages: [4] },
    { id: 5, type: "value_judgment", topic: `${takeAxis(4)} 상황에서 속도와 안정성의 충돌을 어떤 가치로 조정해야 하는가?`, rationale: "가치판단", evidence_pages: [5] },
    { id: 6, type: "value_judgment", topic: `${takeAxis(5)}에 대해 비용 절감보다 품질 보장을 우선해야 하는가?`, rationale: "우선순위 가치판단", evidence_pages: [6] },
    { id: 7, type: "current_relevance", topic: `오늘 학습 내용을 현재 팀 운영 규칙으로 바꾼다면 ${takeAxis(6)}를 어떻게 반영할 수 있는가?`, rationale: "현재적 적용", evidence_pages: [7] },
    { id: 8, type: "current_relevance", topic: `최근 장애 사례를 기준으로 ${takeAxis(7)}을 적용하면 어떤 변화가 가능한가?`, rationale: "현실 적용", evidence_pages: [8] },
    { id: 9, type: "comparison", topic: `${takeAxis(8)}을 달성하기 위해 사전 검증 강화와 사후 모니터링 강화 중 무엇이 더 효과적인가?`, rationale: "운영 전략 비교", evidence_pages: [9] },
    { id: 10, type: "current_relevance", topic: `다음 수업 전까지 ${takeAxis(9)}을 실천으로 옮길 수 있는 최소 단위는 무엇인가?`, rationale: "실천 연결", evidence_pages: [10] },
  ];
};

const postProcessTopics = (topics, summary) => {
  const oneSentenceTopics = (topics || []).map((topic, index) => ({
    ...topic,
    id: index + 1,
    topic: String(topic.topic || "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?。！？])\s+/)[0] || "",
  }));

  const inScope = oneSentenceTopics.filter((topic) => topic.topic && !isOutOfScopeTopic(topic.topic, summary));
  const deduped = deduplicateTopics(inScope.length > 0 ? inScope : oneSentenceTopics);
  const diverse = ensureTopicDiversity(deduped);

  if (diverse.length >= 10) {
    return diverse.slice(0, 10);
  }

  const fallbacks = buildFallbackTopics(summary);
  const merged = deduplicateTopics([...diverse, ...fallbacks]);
  return ensureTopicDiversity(merged).slice(0, 10).map((topic, index) => ({ ...topic, id: index + 1 }));
};

module.exports = {
  deduplicateTopics,
  ensureTopicDiversity,
  buildExcludedPages,
  buildHeuristicDocumentSummary,
  isOutOfScopeTopic,
  buildFallbackTopics,
  postProcessTopics,
  jaccard,
};
