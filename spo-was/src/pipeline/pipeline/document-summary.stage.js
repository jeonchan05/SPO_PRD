const path = require("path");
const { normalizeDocumentSummary, validateDocumentSummary } = require("../models/schema");
const { buildHeuristicDocumentSummary, buildExcludedPages } = require("./heuristics");
const { ensureDir, listFiles, readJson, writeJson } = require("../utils/fs");

const loadPageAnalyses = async (pagesDir) => {
  const files = await listFiles(pagesDir, /^\d+\.json$/);
  if (files.length === 0) {
    throw new Error(`페이지 분석 JSON이 없습니다: ${pagesDir}`);
  }

  const pages = [];
  for (const filePath of files) {
    const row = await readJson(filePath);
    pages.push(row);
  }

  return pages.sort((a, b) => a.page_number - b.page_number);
};

const runDocumentSummaryStage = async ({ outputDir, pagesDir, prompts, adapter, logger }) => {
  await ensureDir(outputDir);
  const pageAnalyses = await loadPageAnalyses(pagesDir);
  logger?.info?.(`[stage:document-summary] pages=${pageAnalyses.length}`);

  let summary = null;
  try {
    const rawSummary = await adapter.summarizeDocument({
      pages: pageAnalyses,
      promptTemplate: prompts.documentSummary,
    });
    summary = normalizeDocumentSummary(rawSummary, buildExcludedPages(pageAnalyses));
  } catch (error) {
    logger?.warn?.(`[stage:document-summary] adapter failed -> heuristic fallback: ${error.message}`);
    summary = buildHeuristicDocumentSummary(pageAnalyses);
  }

  const normalized = normalizeDocumentSummary(summary, buildExcludedPages(pageAnalyses));
  const validation = validateDocumentSummary(normalized);
  if (!validation.valid) {
    const heuristic = buildHeuristicDocumentSummary(pageAnalyses);
    const heuristicValidation = validateDocumentSummary(heuristic);
    if (!heuristicValidation.valid) {
      throw new Error(`document_summary schema invalid: ${heuristicValidation.errors.join("; ")}`);
    }
    summary = heuristic;
  } else {
    summary = normalized;
  }

  const outPath = path.join(outputDir, "document_summary.json");
  await writeJson(outPath, summary);

  return {
    stage: "document-summary",
    documentSummaryPath: outPath,
    summary,
  };
};

module.exports = {
  runDocumentSummaryStage,
  loadPageAnalyses,
};
