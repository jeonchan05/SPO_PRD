const path = require("path");
const { convertPdfToImages, collectPageImages } = require("../pdf/pdf-pages");
const { runImageOcr } = require("../ocr/tesseract");
const { normalizePageAnalysis, validatePageAnalysis } = require("../models/schema");
const { shouldTriggerOcrFallback } = require("./fallback");
const { enrichWithOcr } = require("./enrich");
const { ensureDir, writeJson, writeJsonl, readJson } = require("../utils/fs");
const { mapWithConcurrency } = require("../utils/async");

const extractPageNumber = (imagePath, fallbackIndex) => {
  const base = path.basename(imagePath, path.extname(imagePath));
  const match = base.match(/(\d+)/);
  if (!match) return fallbackIndex + 1;
  return Number.parseInt(match[1], 10);
};

const validateOrThrow = (pageAnalysis, context) => {
  const result = validatePageAnalysis(pageAnalysis);
  if (!result.valid) {
    throw new Error(`[page ${context.pageNumber}] schema invalid: ${result.errors.join("; ")}`);
  }
};

const loadCachedPageAnalysis = async (pageJsonPath) => {
  const cached = await readJson(pageJsonPath).catch(() => null);
  if (!cached) return null;
  const result = validatePageAnalysis(cached);
  return result.valid ? cached : null;
};

const isVisionAbortError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("aborted") || message.includes("aborterror") || message.includes("timeout");
};

const analyzeSinglePage = async ({
  adapter,
  promptTemplate,
  imagePath,
  pageNumber,
  pageJsonPath,
  fallbackOptions,
  ocrLanguage,
  skipExisting,
  logger,
  forceOcr = false,
}) => {
  if (skipExisting) {
    const cached = await loadCachedPageAnalysis(pageJsonPath);
    if (cached) {
      logger?.debug?.(`[page:${pageNumber}] skip existing`);
      return {
        analysis: cached,
        meta: {
          fromCache: true,
          visionFailed: false,
          visionAborted: false,
          forcedOcr: false,
        },
      };
    }
  }

  let raw = null;
  let visionFailed = false;
  let visionAborted = false;

  if (forceOcr) {
    raw = {
      page_number: pageNumber,
      slide_role: "other",
      title: "",
      main_points: [],
      keywords: [],
      facts: [],
      interpretations: [],
      discussion_candidates: [],
      confidence: 0.01,
      used_ocr: false,
      ocr_reason: "force_ocr_only_mode",
    };
  } else {
    try {
      raw = await adapter.analyzePage({
        imagePath,
        pageNumber,
        promptTemplate,
      });
    } catch (error) {
      visionFailed = true;
      visionAborted = isVisionAbortError(error);
      logger?.warn?.(`[page:${pageNumber}] vision adapter failed: ${error.message}`);
      raw = {
        page_number: pageNumber,
        slide_role: "other",
        title: "",
        main_points: [],
        keywords: [],
        facts: [],
        interpretations: [],
        discussion_candidates: [],
        confidence: 0.01,
        used_ocr: false,
        ocr_reason: "vision_adapter_failed",
      };
    }
  }

  let pageAnalysis = normalizePageAnalysis(raw, pageNumber);

  const fallbackDecision = shouldTriggerOcrFallback(pageAnalysis, fallbackOptions);
  if (fallbackDecision.shouldUseOcr) {
    logger?.debug?.(`[page:${pageNumber}] OCR fallback -> ${fallbackDecision.reasons.join(",")}`);
    const ocrResult = await runImageOcr({
      imagePath,
      language: ocrLanguage,
    });

    if (ocrResult.ok && ocrResult.text) {
      pageAnalysis = enrichWithOcr(pageAnalysis, ocrResult.text, fallbackDecision.reasons.join(","));
    } else {
      pageAnalysis = {
        ...pageAnalysis,
        used_ocr: true,
        ocr_reason: `${fallbackDecision.reasons.join(",")};${ocrResult.reason}`,
      };
    }
  }

  validateOrThrow(pageAnalysis, { pageNumber });
  await writeJson(pageJsonPath, pageAnalysis);
  return {
    analysis: pageAnalysis,
    meta: {
      fromCache: false,
      visionFailed,
      visionAborted,
      forcedOcr: forceOcr,
    },
  };
};

const runPageAnalysisStage = async ({
  inputPdfPath,
  pagesDir,
  imagesDir: providedImagesDir,
  outputDir,
  prompts,
  adapter,
  logger,
  dpi = 180,
  concurrency = 2,
  skipExisting = true,
  ocrLanguage = "kor+eng",
  fallbackOptions = {},
  overwriteImages = false,
  onPageAnalyzed,
  visionAbortThreshold = 2,
  forceOcrAllPages = false,
}) => {
  const pagesOutputDir = pagesDir || path.join(outputDir, "pages");
  const imagesDir = providedImagesDir || path.join(outputDir, "images");

  await ensureDir(outputDir);
  await ensureDir(pagesOutputDir);

  let imagePaths = [];
  if (inputPdfPath) {
    const converted = await convertPdfToImages({
      pdfPath: inputPdfPath,
      outDir: imagesDir,
      dpi,
      overwrite: overwriteImages,
      logger,
      onPageDone: ({ pageNumber, pageCount }) => {
        logger?.debug?.(`[pdf] rendered ${pageNumber}/${pageCount}`);
      },
    });
    imagePaths = converted.imagePaths;
  } else {
    imagePaths = await collectPageImages(imagesDir);
  }

  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error("분석할 페이지 이미지가 없습니다.");
  }

  const sortedImagePaths = [...imagePaths].sort((a, b) => a.localeCompare(b));
  const alwaysForceOcr = Boolean(forceOcrAllPages);
  let processedPages = 0;
  let consecutiveVisionAbortCount = 0;
  let visionCircuitOpen = false;

  const analyses = await mapWithConcurrency(
    sortedImagePaths,
    async (imagePath, index) => {
      const pageNumber = extractPageNumber(imagePath, index);
      const pageJsonPath = path.join(pagesOutputDir, `${String(pageNumber).padStart(4, "0")}.json`);
      logger?.info?.(`[stage:page-analysis] page ${pageNumber}/${sortedImagePaths.length}`);
      const result = await analyzeSinglePage({
        adapter,
        promptTemplate: prompts.pageAnalysis,
        imagePath,
        pageNumber,
        pageJsonPath,
        fallbackOptions,
        ocrLanguage,
        skipExisting,
        logger,
        forceOcr: alwaysForceOcr || visionCircuitOpen,
      });
      const { analysis, meta } = result;

      if (!alwaysForceOcr && !meta.fromCache && !meta.forcedOcr) {
        if (meta.visionAborted) {
          consecutiveVisionAbortCount += 1;
          if (!visionCircuitOpen && consecutiveVisionAbortCount >= Math.max(1, Number(visionAbortThreshold) || 1)) {
            visionCircuitOpen = true;
            logger?.warn?.(
              `[stage:page-analysis] vision timeout 반복(${consecutiveVisionAbortCount}회)으로 OCR-only 모드로 전환합니다.`,
            );
          }
        } else if (!meta.visionFailed) {
          consecutiveVisionAbortCount = 0;
        }
      }

      processedPages += 1;
      if (typeof onPageAnalyzed === "function") {
        onPageAnalyzed({
          analysis,
          pageNumber,
          processedPages,
          totalPages: sortedImagePaths.length,
        });
      }
      return analysis;
    },
    { concurrency },
  );

  const sortedAnalyses = analyses.sort((a, b) => a.page_number - b.page_number);
  await writeJsonl(path.join(outputDir, "page_analysis.jsonl"), sortedAnalyses);

  return {
    stage: "page-analysis",
    pageCount: sortedAnalyses.length,
    pagesDir: pagesOutputDir,
    imagesDir,
    jsonlPath: path.join(outputDir, "page_analysis.jsonl"),
    analyses: sortedAnalyses,
  };
};

module.exports = {
  runPageAnalysisStage,
  extractPageNumber,
};
