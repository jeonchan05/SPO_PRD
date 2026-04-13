#!/usr/bin/env node
const path = require("path");
const fs = require("fs/promises");
const { createLogger } = require("../utils/logger");
const { loadAllPrompts } = require("../prompts");
const { createVisionAdapter } = require("../vision");
const { runPageAnalysisStage } = require("../pipeline/page-analysis.stage");
const { runDocumentSummaryStage } = require("../pipeline/document-summary.stage");
const { runTopicsStage } = require("../pipeline/topics.stage");
const { runFullPipeline, resolveAdapterConfig } = require("../pipeline/run-pipeline");

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseArgs = (argv) => {
  const args = argv.slice(2);
  const command = args[0] || "help";
  const positionals = [];
  const flags = {};

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }

  return { command, positionals, flags };
};

const printHelp = () => {
  const lines = [
    "Usage:",
    "  node src/pipeline/cli/pipeline-cli.js analyze-pdf <input.pdf> --out <dir> [--dpi 180] [--concurrency 2]",
    "  node src/pipeline/cli/pipeline-cli.js analyze-pages <images-dir> --out <dir>",
    "  node src/pipeline/cli/pipeline-cli.js summarize-doc <pages-dir> --out <dir|document_summary.json>",
    "  node src/pipeline/cli/pipeline-cli.js generate-topics <document_summary.json> --out <dir|discussion_topics.json>",
    "  node src/pipeline/cli/pipeline-cli.js run-pipeline <input.pdf> --out <dir>",
    "",
    "Common options:",
    "  --provider <mock|openai_compatible|gemma_api|gemini_cli>",
    "  --model <model-name>",
    "  --base-url <api-base-url>",
    "  --api-key <token>",
    "  --verbose",
    "  --skip-existing",
    "  --ocr-language <kor+eng>",
  ];
  console.log(lines.join("\n"));
};

const isJsonPath = (filePath) => path.extname(filePath).toLowerCase() === ".json";

const resolveStageOutputDir = (outFlag, defaultDir, defaultFileName) => {
  if (!outFlag) {
    return {
      outputDir: path.resolve(defaultDir),
      finalPath: path.resolve(defaultDir, defaultFileName),
      requestedFilePath: null,
    };
  }

  const resolved = path.resolve(outFlag);
  if (isJsonPath(resolved)) {
    return {
      outputDir: path.dirname(resolved),
      finalPath: path.join(path.dirname(resolved), defaultFileName),
      requestedFilePath: resolved,
    };
  }

  return {
    outputDir: resolved,
    finalPath: path.join(resolved, defaultFileName),
    requestedFilePath: null,
  };
};

const copyIfNeeded = async (fromPath, toPath) => {
  if (!toPath) return;
  if (path.resolve(fromPath) === path.resolve(toPath)) return;
  await fs.mkdir(path.dirname(toPath), { recursive: true });
  await fs.copyFile(fromPath, toPath);
};

const run = async () => {
  const { command, positionals, flags } = parseArgs(process.argv);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const logger = createLogger(Boolean(flags.verbose));
  const adapterConfig = resolveAdapterConfig({
    provider: flags.provider,
    model: flags.model,
    baseUrl: flags["base-url"],
    apiKey: flags["api-key"],
    systemPrompt: flags["system-prompt"],
  });
  const prompts = await loadAllPrompts();
  const adapter = createVisionAdapter(adapterConfig);

  if (command === "analyze-pdf") {
    const inputPdfPath = positionals[0];
    if (!inputPdfPath) throw new Error("analyze-pdf는 입력 PDF 경로가 필요합니다.");

    const outDir = path.resolve(flags.out || path.join(process.cwd(), "out"));
    const result = await runPageAnalysisStage({
      inputPdfPath,
      outputDir: outDir,
      imagesDir: path.resolve(flags["images-dir"] || path.join(outDir, "images")),
      prompts,
      adapter,
      logger,
      dpi: toNumber(flags.dpi, 180),
      concurrency: toNumber(flags.concurrency, 2),
      skipExisting: Boolean(flags["skip-existing"]),
      ocrLanguage: String(flags["ocr-language"] || "kor+eng"),
      fallbackOptions: {
        minConfidence: Number(flags["min-confidence"] || 0.62),
        minVisibleTextChars: toNumber(flags["min-visible-text"], 26),
      },
      overwriteImages: Boolean(flags["overwrite-images"]),
    });
    logger.info(`완료: ${result.jsonlPath}`);
    return;
  }

  if (command === "analyze-pages") {
    const imagesDir = positionals[0];
    if (!imagesDir) throw new Error("analyze-pages는 이미지 디렉터리 경로가 필요합니다.");

    const outDir = path.resolve(flags.out || path.join(process.cwd(), "out"));
    const result = await runPageAnalysisStage({
      outputDir: outDir,
      imagesDir: path.resolve(imagesDir),
      prompts,
      adapter,
      logger,
      concurrency: toNumber(flags.concurrency, 2),
      skipExisting: Boolean(flags["skip-existing"]),
      ocrLanguage: String(flags["ocr-language"] || "kor+eng"),
      fallbackOptions: {
        minConfidence: Number(flags["min-confidence"] || 0.62),
        minVisibleTextChars: toNumber(flags["min-visible-text"], 26),
      },
    });
    logger.info(`완료: ${result.jsonlPath}`);
    return;
  }

  if (command === "summarize-doc") {
    const pagesDir = positionals[0];
    if (!pagesDir) throw new Error("summarize-doc는 페이지 JSON 디렉터리가 필요합니다.");

    const output = resolveStageOutputDir(flags.out, path.join(process.cwd(), "out"), "document_summary.json");
    const result = await runDocumentSummaryStage({
      outputDir: output.outputDir,
      pagesDir: path.resolve(pagesDir),
      prompts,
      adapter,
      logger,
    });
    await copyIfNeeded(result.documentSummaryPath, output.requestedFilePath);
    logger.info(`완료: ${output.requestedFilePath || result.documentSummaryPath}`);
    return;
  }

  if (command === "generate-topics") {
    const summaryPath = positionals[0];
    if (!summaryPath) throw new Error("generate-topics는 document_summary.json 경로가 필요합니다.");

    const output = resolveStageOutputDir(flags.out, path.join(process.cwd(), "out"), "discussion_topics.json");
    const result = await runTopicsStage({
      outputDir: output.outputDir,
      summaryPath: path.resolve(summaryPath),
      prompts,
      adapter,
      logger,
    });
    await copyIfNeeded(result.discussionTopicsPath, output.requestedFilePath);
    logger.info(`완료: ${output.requestedFilePath || result.discussionTopicsPath}`);
    logger.info(`Markdown: ${result.discussionTopicsMarkdownPath}`);
    return;
  }

  if (command === "run-pipeline") {
    const inputPdfPath = positionals[0];
    if (!inputPdfPath) throw new Error("run-pipeline은 입력 PDF 경로가 필요합니다.");

    const outDir = path.resolve(flags.out || path.join(process.cwd(), "out"));
    const result = await runFullPipeline({
      inputPdfPath,
      outDir,
      logger,
      options: {
        ...adapterConfig,
        dpi: toNumber(flags.dpi, 180),
        concurrency: toNumber(flags.concurrency, 2),
        skipExisting: Boolean(flags["skip-existing"]),
        ocrLanguage: String(flags["ocr-language"] || "kor+eng"),
        overwriteImages: Boolean(flags["overwrite-images"]),
        fallbackOptions: {
          minConfidence: Number(flags["min-confidence"] || 0.62),
          minVisibleTextChars: toNumber(flags["min-visible-text"], 26),
        },
      },
    });
    logger.info(`완료: ${path.join(result.outputDir, "discussion_topics.json")}`);
    return;
  }

  throw new Error(`지원하지 않는 명령어입니다: ${command}`);
};

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pipeline-cli 오류: ${message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  run,
};
