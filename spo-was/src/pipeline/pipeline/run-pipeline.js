const path = require("path");
const fs = require("fs/promises");
const { loadAllPrompts } = require("../prompts");
const { createVisionAdapter } = require("../vision");
const { runPageAnalysisStage } = require("./page-analysis.stage");
const { runDocumentSummaryStage } = require("./document-summary.stage");
const { runTopicsStage } = require("./topics.stage");

const resolveAdapterConfig = (options = {}) => ({
  provider: options.provider,
  model: options.model,
  apiKey: options.apiKey,
  baseUrl: options.baseUrl,
  systemPrompt: options.systemPrompt,
});

const ensureOutputDir = async (outDir) => {
  const resolved = path.resolve(outDir);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
};

const runFullPipeline = async ({
  inputPdfPath,
  outDir,
  logger,
  options = {},
}) => {
  const resolvedOutDir = await ensureOutputDir(outDir);
  const prompts = await loadAllPrompts();
  const adapter = createVisionAdapter(resolveAdapterConfig(options));

  const pageStage = await runPageAnalysisStage({
    inputPdfPath: path.resolve(inputPdfPath),
    outputDir: resolvedOutDir,
    prompts,
    adapter,
    logger,
    dpi: options.dpi,
    concurrency: options.concurrency,
    skipExisting: options.skipExisting,
    ocrLanguage: options.ocrLanguage,
    fallbackOptions: options.fallbackOptions,
    overwriteImages: options.overwriteImages,
  });

  const summaryStage = await runDocumentSummaryStage({
    outputDir: resolvedOutDir,
    pagesDir: pageStage.pagesDir,
    prompts,
    adapter,
    logger,
  });

  const topicsStage = await runTopicsStage({
    outputDir: resolvedOutDir,
    summaryPath: summaryStage.documentSummaryPath,
    prompts,
    adapter,
    logger,
  });

  return {
    outputDir: resolvedOutDir,
    pageStage,
    summaryStage,
    topicsStage,
  };
};

module.exports = {
  runFullPipeline,
  resolveAdapterConfig,
};
