const path = require("path");
const { normalizeDiscussionTopics, validateDiscussionTopics } = require("../models/schema");
const { postProcessTopics } = require("./heuristics");
const { ensureDir, readJson, writeJson } = require("../utils/fs");

const toMarkdown = (topicResult) => {
  const lines = [];
  lines.push(`# 토론 주제 10개`);
  lines.push("");
  lines.push(`- 문서 주제: ${topicResult.document_theme}`);
  lines.push("");

  for (const topic of topicResult.topics) {
    lines.push(`## ${topic.id}. ${topic.topic}`);
    lines.push(`- 유형: ${topic.type}`);
    lines.push(`- 근거: ${topic.rationale}`);
    lines.push(`- 페이지 근거: ${topic.evidence_pages.join(", ") || "없음"}`);
    lines.push("");
  }

  return lines.join("\n");
};

const runTopicsStage = async ({ outputDir, summaryPath, prompts, adapter, logger }) => {
  await ensureDir(outputDir);
  const summary = await readJson(summaryPath);

  logger?.info?.("[stage:topics] generating discussion topics");

  let rawTopics = null;
  try {
    rawTopics = await adapter.generateTopics({
      summary,
      promptTemplate: prompts.discussionTopics,
    });
  } catch (error) {
    logger?.warn?.(`[stage:topics] adapter failed -> post fallback: ${error.message}`);
    rawTopics = {
      document_theme: summary.document_theme,
      topics: [],
    };
  }

  const normalized = normalizeDiscussionTopics(rawTopics);
  const curatedTopics = postProcessTopics(normalized.topics, summary);

  const finalResult = {
    document_theme: normalized.document_theme || summary.document_theme,
    topics: curatedTopics,
  };

  const validation = validateDiscussionTopics(finalResult, 10);
  if (!validation.valid) {
    throw new Error(`discussion_topics schema invalid: ${validation.errors.join("; ")}`);
  }

  const jsonPath = path.join(outputDir, "discussion_topics.json");
  const mdPath = path.join(outputDir, "discussion_topics.md");
  await writeJson(jsonPath, finalResult);
  await require("fs/promises").writeFile(mdPath, `${toMarkdown(finalResult)}\n`, "utf8");

  return {
    stage: "topics",
    discussionTopicsPath: jsonPath,
    discussionTopicsMarkdownPath: mdPath,
    result: finalResult,
  };
};

module.exports = {
  runTopicsStage,
  toMarkdown,
};
