const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { pool } = require("../config/db");
const { fetchUserById } = require("../modules/common/user.repository");
const { toPositiveInt } = require("../modules/common/value.utils");
const { publishMaterialStatus } = require("../realtime/material-publisher");
const { loadAllPrompts } = require("../pipeline/prompts");
const { runPageAnalysisStage } = require("../pipeline/pipeline/page-analysis.stage");
const { parseJsonFromText } = require("../pipeline/models/schema");
const { createUserNotification } = require("./notification.service");

const execFileAsync = promisify(execFile);
const resolveConcurrency = (...candidates) => {
  for (const candidate of candidates) {
    const parsed = Number.parseInt(String(candidate || ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};
const DEFAULT_OCR_CONCURRENCY = Math.max(2, Math.min(6, os.cpus()?.length || 4));
const OCR_CONCURRENCY = Math.max(
  1,
  resolveConcurrency(
    process.env.MATERIAL_LEGACY_OCR_CONCURRENCY,
    process.env.MATERIAL_PIPELINE_PAGE_CONCURRENCY,
    process.env.OCR_CONCURRENCY,
    DEFAULT_OCR_CONCURRENCY,
  ),
);

const MATERIAL_UPLOAD_DIR = path.resolve(
  process.env.MATERIAL_UPLOAD_DIR || path.join(process.cwd(), "uploads", "materials"),
);
const MATERIAL_PUBLIC_BASE_URL = String(process.env.MATERIAL_PUBLIC_BASE_URL || "/uploads/materials").replace(
  /\/+$/,
  "",
);
const MATERIAL_PIPELINE_OUTPUT_DIR = path.resolve(
  process.env.MATERIAL_PIPELINE_OUTPUT_DIR || path.join(process.cwd(), "uploads", "material-pipeline"),
);
const DEFAULT_GEMMA_API_BASE_URL = "http://127.0.0.1:11434";
const GEMMA_API_BASE_URL = String(
  process.env.GEMMA_API_BASE_URL ||
    process.env.QWEN_API_BASE_URL ||
    process.env.OPENAI_COMPATIBLE_API_BASE_URL ||
    process.env.MODEL_BASE_URL ||
    DEFAULT_GEMMA_API_BASE_URL,
).trim();
const GEMMA_API_KEY = String(process.env.GEMMA_API_KEY || process.env.QWEN_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY || "").trim();
const GEMMA_MODEL = String(process.env.GEMMA_MODEL || process.env.QWEN_MODEL || "gemma4:e4b").trim();
const GEMMA_REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.GEMMA_REQUEST_TIMEOUT_MS || process.env.MODEL_REQUEST_TIMEOUT_MS || ""), 10) || 300000,
);
const GEMMA_SUMMARY_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.GEMMA_SUMMARY_TIMEOUT_MS || ""), 10) || 180000,
);
const GEMMA_TOPIC_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.GEMMA_TOPIC_TIMEOUT_MS || ""), 10) || 90000,
);
const GEMMA_FEEDBACK_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.GEMMA_FEEDBACK_TIMEOUT_MS || ""), 10) || 90000,
);
const GEMMA_TOPIC_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(String(process.env.GEMMA_TOPIC_RETRY_ATTEMPTS || ""), 10) || 3,
);
const GEMMA_TOPIC_RETRY_DELAY_MS = Math.max(
  0,
  Number.parseInt(String(process.env.GEMMA_TOPIC_RETRY_DELAY_MS || ""), 10) || 1200,
);
const GEMMA_TOPIC_FORCE_MODEL_RESPONSE = String(process.env.GEMMA_TOPIC_FORCE_MODEL_RESPONSE || "true")
  .trim()
  .toLowerCase() !== "false";
const MATERIAL_AI_PROVIDER = String(process.env.MATERIAL_AI_PROVIDER || process.env.AI_PROVIDER || "gemma_api")
  .trim()
  .toLowerCase();
const MATERIAL_AI_ENABLE_FEEDBACK = String(process.env.MATERIAL_AI_ENABLE_FEEDBACK || "false")
  .trim()
  .toLowerCase() === "true";
const GEMINI_CLI_BIN = String(process.env.GEMINI_CLI_BIN || "gemini").trim() || "gemini";
const GEMINI_CLI_NODE_BIN = String(process.env.GEMINI_CLI_NODE_BIN || process.execPath || "node").trim() || "node";
const GEMINI_CLI_ENTRYPOINT = String(process.env.GEMINI_CLI_ENTRYPOINT || "").trim();
const GEMINI_CLI_MODEL = String(process.env.GEMINI_CLI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const GEMINI_CLI_APPROVAL_MODE = String(process.env.GEMINI_CLI_APPROVAL_MODE || "plan").trim() || "plan";
const GEMINI_CLI_OUTPUT_FORMAT = String(process.env.GEMINI_CLI_OUTPUT_FORMAT || "json").trim() || "json";
const GEMINI_CLI_EXTRA_ARGS = String(process.env.GEMINI_CLI_EXTRA_ARGS || "").trim();
const GEMINI_CLI_OAUTH_ONLY = String(process.env.GEMINI_CLI_OAUTH_ONLY || "true")
  .trim()
  .toLowerCase() !== "false";
const GEMINI_CLI_REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(String(process.env.GEMINI_CLI_REQUEST_TIMEOUT_MS || process.env.MODEL_REQUEST_TIMEOUT_MS || ""), 10) ||
    GEMMA_REQUEST_TIMEOUT_MS,
);
const AI_RESPONSE_LOG_ENABLED = String(process.env.AI_RESPONSE_LOG_ENABLED || "true")
  .trim()
  .toLowerCase() !== "false";
const AI_RESPONSE_LOG_MAX_CHARS = Math.max(
  120,
  Number.parseInt(String(process.env.AI_RESPONSE_LOG_MAX_CHARS || ""), 10) || 1800,
);
const MATERIAL_TOPIC_RECOMMENDATIONS_TABLE = "material_ai_topic_recommendations";
const MATERIAL_FEEDBACKS_TABLE = "material_ai_feedbacks";
const MATERIAL_PROCESSING_STALE_MINUTES = Math.max(
  10,
  Number.parseInt(String(process.env.MATERIAL_PROCESSING_STALE_MINUTES || ""), 10) || 30,
);

let materialSchemaReady = false;

const MATERIAL_STATUS = {
  UPLOADED: "uploaded",
  PROCESSING: "processing",
  COMPLETED: "completed",
  AI_UNAVAILABLE: "ai_unavailable",
  FAILED: "failed",
};

const notifyMaterialStatus = (payload) => {
  const materialId = toPositiveInt(payload?.materialId);
  const userId = toPositiveInt(payload?.userId);
  const status = String(payload?.status || "").toLowerCase();
  if (!materialId || !userId || !status) return;

  publishMaterialStatus({
    materialId,
    userId,
    status,
    errorMessage: payload?.errorMessage || null,
    progressPercent: payload?.progressPercent,
    stage: payload?.stage,
    message: payload?.message,
    processedPages: payload?.processedPages,
    totalPages: payload?.totalPages,
    updatedAt: new Date().toISOString(),
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[material:${materialId}] realtime publish failed: ${message}`);
  });
};

const notifyUser = (payload) => {
  createUserNotification(payload).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[notification:user:${payload?.userId || "unknown"}] create failed: ${message}`);
  });
};

const normalizeNotificationLink = (value) => {
  const link = String(value || "").trim();
  if (!link) return null;
  if (!link.startsWith("/")) return null;
  return link.slice(0, 500);
};

const resolveUser = async (req) => {
  const userId = toPositiveInt(req.auth?.userId);
  if (!userId) {
    return { error: { status: 401, body: { message: "로그인이 필요합니다." } } };
  }

  const user = await fetchUserById(pool, userId);
  if (!user) {
    return { error: { status: 404, body: { message: "사용자 정보를 찾을 수 없습니다." } } };
  }

  if (user.status !== "active") {
    return { error: { status: 403, body: { message: "비활성화된 계정입니다. 관리자에게 문의해주세요." } } };
  }

  return { user };
};

const ensureMaterialSchema = async () => {
  if (materialSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploaded_materials (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      original_file_name VARCHAR(255) NOT NULL,
      file_url TEXT NOT NULL,
      storage_path TEXT NULL,
      file_type ENUM('pdf', 'ppt', 'pptx') NOT NULL,
      mime_type VARCHAR(150) NULL,
      file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'uploaded',
      extracted_text LONGTEXT NULL,
      error_message TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_uploaded_materials_user_id (user_id),
      KEY idx_uploaded_materials_status (status),
      CONSTRAINT fk_uploaded_materials_user FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_pages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      material_id BIGINT UNSIGNED NOT NULL,
      page_no INT UNSIGNED NOT NULL,
      raw_text LONGTEXT NULL,
      ocr_text LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_material_pages_material_page (material_id, page_no),
      CONSTRAINT fk_material_pages_material FOREIGN KEY (material_id) REFERENCES uploaded_materials(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_summaries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      material_id BIGINT UNSIGNED NOT NULL,
      chunk_index INT UNSIGNED NOT NULL,
      summary_text LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_material_summaries_material_chunk (material_id, chunk_index),
      CONSTRAINT fk_material_summaries_material FOREIGN KEY (material_id) REFERENCES uploaded_materials(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MATERIAL_TOPIC_RECOMMENDATIONS_TABLE} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      material_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      result_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_topic_recommendations_user_id (user_id),
      CONSTRAINT fk_topic_recommendations_material FOREIGN KEY (material_id) REFERENCES uploaded_materials(id) ON DELETE CASCADE,
      CONSTRAINT fk_topic_recommendations_user FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MATERIAL_FEEDBACKS_TABLE} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      material_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      result_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ai_feedbacks_user_id (user_id),
      CONSTRAINT fk_ai_feedbacks_material FOREIGN KEY (material_id) REFERENCES uploaded_materials(id) ON DELETE CASCADE,
      CONSTRAINT fk_ai_feedbacks_user FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const staleThreshold = new Date(Date.now() - MATERIAL_PROCESSING_STALE_MINUTES * 60 * 1000);
  await pool.query(
    `UPDATE uploaded_materials
     SET status = ?, error_message = ?, updated_at = NOW()
     WHERE status IN (?, ?) AND updated_at < ?`,
    [
      MATERIAL_STATUS.FAILED,
      `자료 처리 시간이 ${MATERIAL_PROCESSING_STALE_MINUTES}분을 넘어 중단되었습니다. 다시 업로드해 주세요.`,
      MATERIAL_STATUS.UPLOADED,
      MATERIAL_STATUS.PROCESSING,
      staleThreshold,
    ],
  );

  materialSchemaReady = true;
};

const countHangulChars = (value) => (String(value || "").match(/[가-힣]/g) || []).length;
const countMojibakeChars = (value) =>
  (String(value || "").match(/[ÃÂÀÁÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;

const normalizeOriginalFileName = (originalName) => {
  const raw = String(originalName || "").trim();
  if (!raw) return "material";

  let decoded = raw;
  try {
    decoded = Buffer.from(raw, "latin1").toString("utf8");
  } catch (_error) {
    return raw;
  }

  if (!decoded || decoded.includes("\u0000") || decoded.includes("�")) return raw;

  const rawHangul = countHangulChars(raw);
  const decodedHangul = countHangulChars(decoded);
  if (decodedHangul > rawHangul) return decoded;

  const rawMojibake = countMojibakeChars(raw);
  const decodedMojibake = countMojibakeChars(decoded);
  if (rawMojibake > decodedMojibake) return decoded;

  return raw;
};

const resolveFileType = (file, originalName = file.originalname) => {
  const extension = path.extname(originalName || "").toLowerCase();
  if (extension === ".pdf" || file.mimetype === "application/pdf") return "pdf";
  if (extension === ".pptx") return "pptx";
  if (extension === ".ppt") return "ppt";
  return null;
};

const sanitizeFileName = (fileName) =>
  String(fileName || "material")
    .replace(/[^\w.\-가-힣\s]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160);

const saveMaterialFile = async (file, originalName = file.originalname) => {
  await fs.mkdir(MATERIAL_UPLOAD_DIR, { recursive: true });
  const extension = path.extname(originalName || "") || ".bin";
  const sanitizedOriginalName = sanitizeFileName(originalName);
  const hasSameExtension = extension
    ? sanitizedOriginalName.toLowerCase().endsWith(extension.toLowerCase())
    : false;
  const objectName = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${sanitizedOriginalName}${
    hasSameExtension ? "" : extension
  }`;
  const storagePath = path.join(MATERIAL_UPLOAD_DIR, objectName);
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, file.buffer);

  return {
    storagePath,
    fileUrl: `${MATERIAL_PUBLIC_BASE_URL}/${objectName.split(path.sep).map(encodeURIComponent).join("/")}`,
  };
};

const cleanText = (text) => {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set();
  return normalized
    .filter((line) => {
      const key = line.toLowerCase();
      if (line.length > 12 && seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
};

const buildCompactPromptText = (text, maxChars = 2400) => {
  const compact = cleanText(text).replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  const cut = compact.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > Math.floor(maxChars * 0.6) ? cut.slice(0, lastSpace) : cut).trim();
};

const buildLogPreview = (text, limit = 240) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(20, Number(limit) || 240));

const toJsonPreviewString = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value || "");
  }
};

const logAiResponsePreview = (tag, value) => {
  if (!AI_RESPONSE_LOG_ENABLED) return;
  const preview = buildLogPreview(toJsonPreviewString(value), AI_RESPONSE_LOG_MAX_CHARS);
  console.info(`[ai:${tag}] response preview: ${preview}`);
};

const logAiInferenceTiming = ({ tag, model, status, elapsedMs, detail = "" }) => {
  const safeTag = String(tag || "gemma");
  const safeModel = String(model || GEMMA_MODEL || "unknown");
  const safeStatus = String(status || "unknown");
  const ms = Number.isFinite(Number(elapsedMs)) ? Math.max(0, Math.floor(Number(elapsedMs))) : 0;
  const suffix = detail ? ` detail=${detail}` : "";
  console.info(`[ai:${safeTag}] model=${safeModel} status=${safeStatus} elapsedMs=${ms}${suffix}`);
};

const splitCliArgs = (rawArgs) => {
  const source = String(rawArgs || "").trim();
  if (!source) return [];

  const chunks = source.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return chunks
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const hasDoubleQuote = part.startsWith('"') && part.endsWith('"');
      const hasSingleQuote = part.startsWith("'") && part.endsWith("'");
      return hasDoubleQuote || hasSingleQuote ? part.slice(1, -1) : part;
    });
};

const resolveMaterialAiProvider = (rawProvider = MATERIAL_AI_PROVIDER) => {
  const normalized = String(rawProvider || "")
    .trim()
    .toLowerCase();
  if (normalized === "gemini_cli" || normalized === "gemini-cli" || normalized === "gemini") return "gemini_cli";
  return "gemma_api";
};

const resolveMaterialAiModel = (provider) => {
  if (provider === "gemini_cli") return GEMINI_CLI_MODEL || "gemini-2.5-flash";
  return GEMMA_MODEL || "gemma4:e4b";
};

const resolveMaterialAiLabel = () => {
  const provider = resolveMaterialAiProvider();
  return `${provider}:${resolveMaterialAiModel(provider)}`;
};

const isExecTimeoutError = (error) => {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const signal = String(error.signal || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return code === "ETIMEDOUT" || signal === "SIGTERM" || error.killed === true || message.includes("timed out");
};

const buildCliEnv = (command) => {
  const base = { ...process.env };
  if (GEMINI_CLI_OAUTH_ONLY) {
    delete base.GEMINI_API_KEY;
    delete base.GOOGLE_API_KEY;
    delete base.GOOGLE_CLOUD_PROJECT;
    base.GOOGLE_GENAI_USE_VERTEXAI = "false";
    base.GOOGLE_GENAI_USE_GCA = "false";
  }
  if (!String(command || "").includes(path.sep)) {
    return base;
  }
  const binDir = path.dirname(String(command));
  base.PATH = `${binDir}:${base.PATH || ""}`;
  return base;
};

const buildGeminiAuthWarning = () =>
  [
    "Gemini CLI 인증이 필요합니다. OAuth 로그인을 1회 진행해주세요.",
    "실행: docker exec -it spo-was /usr/local/bin/node /usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js",
    "로그인 후 다시 시도하면 OAuth 세션을 재사용합니다.",
  ].join(" ");

const buildGeminiEntrypointCandidates = () => {
  const candidates = [];
  if (GEMINI_CLI_ENTRYPOINT) candidates.push(GEMINI_CLI_ENTRYPOINT);
  if (String(GEMINI_CLI_BIN || "").includes(path.sep)) {
    const derived = String(GEMINI_CLI_BIN).replace(
      new RegExp(`${path.sep}bin${path.sep}gemini$`),
      `${path.sep}lib${path.sep}node_modules${path.sep}@google${path.sep}gemini-cli${path.sep}bundle${path.sep}gemini.js`,
    );
    if (derived && derived !== GEMINI_CLI_BIN) candidates.push(derived);
  }
  candidates.push("/usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js");
  return Array.from(new Set(candidates.filter(Boolean)));
};

const resolveGeminiCliInvocation = async (cliArgs) => {
  const candidates = buildGeminiEntrypointCandidates();
  for (const entryPath of candidates) {
    try {
      await fs.access(entryPath);
      return {
        command: GEMINI_CLI_NODE_BIN,
        args: [entryPath, ...cliArgs],
        env: buildCliEnv(GEMINI_CLI_NODE_BIN),
        usingEntrypoint: true,
      };
    } catch (_error) {
      // no-op
    }
  }

  return {
    command: GEMINI_CLI_BIN,
    args: cliArgs,
    env: buildCliEnv(GEMINI_CLI_BIN),
    usingEntrypoint: false,
  };
};

const stripXml = (xml) =>
  cleanText(
    String(xml || "")
      .replace(/<a:t[^>]*>/g, " ")
      .replace(/<\/a:t>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

const runCommand = async (command, args, options = {}) => {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout || 30000,
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    });
    return result.stdout || "";
  } catch (_error) {
    return "";
  }
};

const mapWithConcurrency = async (items, limit, worker, onDone) => {
  if (!Array.isArray(items) || items.length === 0) return [];

  const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      const itemResult = await worker(items[current], current);
      results[current] = itemResult;
      if (typeof onDone === "function") {
        onDone(itemResult, current, items.length);
      }
    }
  });

  await Promise.all(runners);
  return results;
};

const extractPdfText = async (filePath, options = {}) => {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const textLayer = await runCommand("pdftotext", ["-layout", filePath, "-"], { timeout: 45000 });
  const cleanTextLayer = cleanText(textLayer);
  if (cleanTextLayer.length >= 80) {
    if (onProgress) {
      onProgress({
        progressPercent: 75,
        stage: "pdf_text_layer",
        message: "PDF 텍스트 레이어 추출을 완료했습니다.",
        processedPages: 1,
        totalPages: 1,
      });
    }
    return {
      text: cleanTextLayer,
      pages: [{ pageNo: 1, rawText: cleanTextLayer, ocrText: null }],
      extractionMethod: "pdf-text-layer",
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spo-pdf-ocr-"));
  try {
    await runCommand("pdftoppm", ["-png", "-r", "180", filePath, path.join(tempDir, "page")], { timeout: 60000 });
    const files = (await fs.readdir(tempDir).catch(() => []))
      .filter((name) => name.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b));
    let processedCount = 0;
    if (onProgress && files.length > 0) {
      onProgress({
        progressPercent: 20,
        stage: "pdf_ocr",
        message: `OCR를 시작합니다. (0/${files.length})`,
        processedPages: 0,
        totalPages: files.length,
      });
    }

    const pageResults = await mapWithConcurrency(files, OCR_CONCURRENCY, async (fileName, index) => {
      const imagePath = path.join(tempDir, fileName);
      const ocrText = cleanText(await runCommand("tesseract", [imagePath, "stdout", "-l", "kor+eng"], { timeout: 60000 }));
      return {
        pageNo: index + 1,
        ocrText,
      };
    }, (_result, _index, total) => {
      processedCount += 1;
      if (!onProgress) return;
      const progressPercent = Math.max(20, Math.min(85, 20 + Math.floor((processedCount / total) * 65)));
      onProgress({
        progressPercent,
        stage: "pdf_ocr",
        message: `OCR를 진행 중입니다. (${processedCount}/${total})`,
        processedPages: processedCount,
        totalPages: total,
      });
    });
    const pages = pageResults
      .filter((result) => String(result?.ocrText || "").trim())
      .map((result) => ({ pageNo: result.pageNo, rawText: null, ocrText: result.ocrText }));

    if (pages.length > 0) {
      if (onProgress) {
        onProgress({
          progressPercent: 90,
          stage: "pdf_ocr_done",
          message: "OCR 텍스트를 정리하고 있습니다.",
          processedPages: pages.length,
          totalPages: files.length || pages.length,
        });
      }
      return {
        text: cleanText(pages.map((page) => page.ocrText).join("\n\n")),
        pages,
        extractionMethod: "pdf-ocr",
      };
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    text: "",
    pages: [],
    extractionMethod: "pdf-unavailable",
  };
};

const extractPptxText = async (filePath, options = {}) => {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const listing = await runCommand("unzip", ["-Z1", filePath], { timeout: 30000 });
  const archivePaths = listing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const slidePaths = archivePaths
    .filter((line) => /^ppt\/slides\/slide\d+\.xml$/.test(line))
    .sort((a, b) => {
      const aNo = Number(a.match(/slide(\d+)\.xml/)?.[1] || 0);
      const bNo = Number(b.match(/slide(\d+)\.xml/)?.[1] || 0);
      return aNo - bNo;
    });
  const mediaPaths = archivePaths
    .filter((line) => /^ppt\/media\/.+\.(png|jpe?g|webp|tiff?)$/i.test(line))
    .sort((a, b) => a.localeCompare(b));

  const totalWork = Math.max(1, slidePaths.length + mediaPaths.length);
  let completedWork = 0;
  const pages = [];
  const slideResults = await mapWithConcurrency(
    slidePaths,
    OCR_CONCURRENCY,
    async (slidePath, index) => {
      const slideNo = Number(slidePath.match(/slide(\d+)\.xml/)?.[1] || index + 1);
      const xml = await runCommand("unzip", ["-p", filePath, slidePath], { timeout: 30000 });
      const rawText = stripXml(xml);
      if (!rawText) return null;
      return { pageNo: slideNo, rawText, ocrText: null };
    },
    () => {
      completedWork += 1;
      if (!onProgress) return;
      const progressPercent = Math.max(20, Math.min(65, 20 + Math.floor((completedWork / totalWork) * 45)));
      onProgress({
        progressPercent,
        stage: "pptx_slide_parse",
        message: `슬라이드 텍스트를 분석 중입니다. (${completedWork}/${totalWork})`,
        processedPages: completedWork,
        totalPages: totalWork,
      });
    },
  );
  slideResults
    .filter(Boolean)
    .sort((a, b) => a.pageNo - b.pageNo)
    .forEach((page) => pages.push(page));

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spo-pptx-media-"));
  try {
    const mediaOcrResults = await mapWithConcurrency(mediaPaths, OCR_CONCURRENCY, async (mediaPath) => {
      const mediaBuffer = await execFileAsync("unzip", ["-p", filePath, mediaPath], {
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024,
        encoding: "buffer",
      })
        .then((result) => result.stdout)
        .catch(() => null);
      if (!mediaBuffer) return "";

      const extension = path.extname(mediaPath) || ".png";
      const imagePath = path.join(tempDir, `${crypto.randomUUID()}${extension}`);
      await fs.writeFile(imagePath, mediaBuffer);
      const ocrText = cleanText(await runCommand("tesseract", [imagePath, "stdout", "-l", "kor+eng"], { timeout: 60000 }));
      await fs.rm(imagePath, { force: true }).catch(() => {});
      return ocrText;
    }, () => {
      completedWork += 1;
      if (!onProgress) return;
      const progressPercent = Math.max(40, Math.min(90, 20 + Math.floor((completedWork / totalWork) * 70)));
      onProgress({
        progressPercent,
        stage: "pptx_media_ocr",
        message: `이미지 OCR를 진행 중입니다. (${completedWork}/${totalWork})`,
        processedPages: completedWork,
        totalPages: totalWork,
      });
    });

    let nextPageNo = pages.reduce((max, page) => Math.max(max, Number(page?.pageNo || 0)), 0) + 1;
    mediaOcrResults.forEach((ocrText) => {
      if (String(ocrText || "").trim()) {
        pages.push({ pageNo: nextPageNo, rawText: null, ocrText });
        nextPageNo += 1;
      }
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  if (onProgress) {
    onProgress({
      progressPercent: 92,
      stage: "pptx_ocr_done",
      message: "추출 텍스트를 정리하고 있습니다.",
      processedPages: completedWork,
      totalPages: totalWork,
    });
  }

  return {
    text: cleanText(pages.map((page) => [page.rawText, page.ocrText].filter(Boolean).join("\n")).join("\n\n")),
    pages,
    extractionMethod: pages.length > 0 ? "pptx-slide-xml" : "pptx-unavailable",
  };
};

const extractPptText = async (filePath, options = {}) => {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  if (onProgress) {
    onProgress({
      progressPercent: 20,
      stage: "ppt_text_extract",
      message: "PPT 텍스트를 추출 중입니다.",
      processedPages: 0,
      totalPages: 1,
    });
  }

  const catpptText = cleanText(await runCommand("catppt", ["-d", "utf-8", filePath], { timeout: 45000 }));
  if (catpptText.length >= 40) {
    if (onProgress) {
      onProgress({
        progressPercent: 90,
        stage: "ppt_text_done",
        message: "PPT 텍스트 추출을 완료했습니다.",
        processedPages: 1,
        totalPages: 1,
      });
    }
    return {
      text: catpptText,
      pages: [{ pageNo: 1, rawText: catpptText, ocrText: null }],
      extractionMethod: "ppt-catppt",
    };
  }

  const stringsText = cleanText(await runCommand("strings", ["-n", "4", filePath], { timeout: 45000 }));
  if (stringsText.length >= 80) {
    if (onProgress) {
      onProgress({
        progressPercent: 90,
        stage: "ppt_text_done",
        message: "PPT 텍스트 추출을 완료했습니다.",
        processedPages: 1,
        totalPages: 1,
      });
    }
    return {
      text: stringsText,
      pages: [{ pageNo: 1, rawText: stringsText, ocrText: null }],
      extractionMethod: "ppt-strings",
    };
  }

  return {
    text: "",
    pages: [],
    extractionMethod: "ppt-unavailable",
  };
};

const extractFallbackText = (buffer) =>
  cleanText(
    buffer
      .toString("utf8")
      .replace(/[^\x09\x0A\x0D\x20-\x7E가-힣ㄱ-ㅎㅏ-ㅣ.,!?()[\]{}:;'"“”‘’·•\-_/]/g, " "),
  );

const extractMaterialText = async (fileType, filePath, buffer, options = {}) => {
  if (fileType === "pdf") {
    const extracted = await extractPdfText(filePath, options);
    if (extracted.text) return extracted;
  }

  if (fileType === "pptx") {
    const extracted = await extractPptxText(filePath, options);
    if (extracted.text) return extracted;
  }

  if (fileType === "ppt") {
    const extracted = await extractPptText(filePath, options);
    if (extracted.text) return extracted;
  }

  const fallbackText = extractFallbackText(buffer);
  return {
    text: fallbackText,
    pages: fallbackText ? [{ pageNo: 1, rawText: fallbackText, ocrText: null }] : [],
    extractionMethod: `${fileType}-fallback`,
  };
};

const resolveGemmaChatUrl = () => {
  if (!GEMMA_API_BASE_URL) return null;
  const normalized = GEMMA_API_BASE_URL.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
};

const gemmaSystemPrompt = [
  "You are a learning assistant that analyzes class material and returns structured JSON.",
  "Always respond in Korean only.",
  "Do not output English sentences in the final answer.",
  "Do not add facts that are not grounded in the provided material.",
  "Return only the JSON object that matches the requested schema.",
  "Do not wrap output with markdown code fences.",
].join("\n");

const callGemmaJson = async (userPrompt, fallbackValue, options = {}) => {
  const chatUrl = resolveGemmaChatUrl();
  if (!chatUrl) {
    return { value: fallbackValue, generatedBy: "fallback", warning: "GEMMA_API_BASE_URL이 설정되지 않았습니다." };
  }

  const timeoutMs = Math.max(
    5000,
    Number.parseInt(String(options.timeoutMs || ""), 10) || GEMMA_REQUEST_TIMEOUT_MS,
  );
  const temperature = Number.parseFloat(String(options.temperature || ""));
  const maxTokens = Number.parseInt(String(options.maxTokens || ""), 10);

  const requestBody = {
    model: GEMMA_MODEL,
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: gemmaSystemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    requestBody.max_tokens = Math.floor(maxTokens);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const startedAt = Date.now();
  const logTag = String(options.logTag || "gemma");

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GEMMA_API_KEY ? { Authorization: `Bearer ${GEMMA_API_KEY}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      logAiInferenceTiming({
        tag: logTag,
        model: GEMMA_MODEL,
        status: "http_error",
        elapsedMs: Date.now() - startedAt,
        detail: `http_${response.status}`,
      });
      return {
        value: fallbackValue,
        generatedBy: "fallback",
        warning: `Gemma 호출 실패: HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      logAiInferenceTiming({
        tag: logTag,
        model: GEMMA_MODEL,
        status: "empty_content",
        elapsedMs: Date.now() - startedAt,
      });
      return { value: fallbackValue, generatedBy: "fallback", warning: "Gemma 응답이 비어 있습니다." };
    }
    logAiResponsePreview(`${logTag}:raw`, content);

    let parsedValue = null;
    try {
      parsedValue = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    } catch (error) {
      const message = error instanceof Error ? error.message : "JSON 파싱 실패";
      logAiInferenceTiming({
        tag: logTag,
        model: GEMMA_MODEL,
        status: "parse_error",
        elapsedMs: Date.now() - startedAt,
        detail: buildLogPreview(message, 120),
      });
      return {
        value: fallbackValue,
        generatedBy: "fallback",
        warning: `Gemma 응답 JSON 파싱 실패: ${message}`,
      };
    }

    logAiResponsePreview(`${logTag}:parsed`, parsedValue);
    logAiInferenceTiming({
      tag: logTag,
      model: GEMMA_MODEL,
      status: "success",
      elapsedMs: Date.now() - startedAt,
    });
    return { value: parsedValue, generatedBy: GEMMA_MODEL, warning: null };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    const elapsedMs = Date.now() - startedAt;
    logAiInferenceTiming({
      tag: logTag,
      model: GEMMA_MODEL,
      status: isAbort ? "timeout" : "exception",
      elapsedMs,
      detail: error instanceof Error ? buildLogPreview(error.message, 120) : "",
    });
    return {
      value: fallbackValue,
      generatedBy: "fallback",
      warning: isAbort
        ? `Gemma 요청 타임아웃(${timeoutMs}ms, elapsed=${elapsedMs}ms)`
        : error instanceof Error
          ? error.message
          : "Gemma 처리 중 오류가 발생했습니다.",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const callGeminiCliJson = async (userPrompt, fallbackValue, options = {}) => {
  const timeoutMs = Math.max(
    5000,
    Number.parseInt(String(options.timeoutMs || ""), 10) || GEMINI_CLI_REQUEST_TIMEOUT_MS,
  );
  const model = String(options.model || GEMINI_CLI_MODEL || "gemini-2.5-flash").trim();
  const logTag = String(options.logTag || "gemini_cli");
  const startedAt = Date.now();
  const cliArgs = [
    ...splitCliArgs(GEMINI_CLI_EXTRA_ARGS),
    "-m",
    model,
    "--approval-mode",
    GEMINI_CLI_APPROVAL_MODE,
    "--output-format",
    GEMINI_CLI_OUTPUT_FORMAT,
    "-p",
    userPrompt,
  ];
  const invocation = await resolveGeminiCliInvocation(cliArgs);

  try {
    const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: invocation.env,
    });
    const rawOutput = String(stdout || "").trim();
    if (!rawOutput) {
      const stderrPreview = buildLogPreview(String(stderr || ""), 160);
      logAiInferenceTiming({
        tag: logTag,
        model,
        status: "empty_content",
        elapsedMs: Date.now() - startedAt,
        detail: stderrPreview,
      });
      return {
        value: fallbackValue,
        generatedBy: "fallback",
        warning: "Gemini CLI 응답이 비어 있습니다.",
      };
    }

    logAiResponsePreview(`${logTag}:raw`, rawOutput);

    let responseText = rawOutput;
    try {
      const cliPayload = JSON.parse(rawOutput);
      if (typeof cliPayload?.response === "string" && cliPayload.response.trim()) {
        responseText = cliPayload.response.trim();
      } else if (typeof cliPayload?.result === "string" && cliPayload.result.trim()) {
        responseText = cliPayload.result.trim();
      }
    } catch (_error) {
      responseText = rawOutput;
    }

    let parsedValue = null;
    try {
      parsedValue = parseJsonFromText(responseText);
    } catch (_primaryError) {
      parsedValue = parseJsonFromText(rawOutput);
    }

    logAiResponsePreview(`${logTag}:parsed`, parsedValue);
    logAiInferenceTiming({
      tag: logTag,
      model,
      status: "success",
      elapsedMs: Date.now() - startedAt,
      detail: invocation.usingEntrypoint ? "entrypoint_mode" : "",
    });
    return {
      value: parsedValue,
      generatedBy: `gemini_cli:${model}`,
      warning: null,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timeout = isExecTimeoutError(error);
    const stderrText = buildLogPreview(error?.stderr || "", 160);
    const detail = [
      timeout ? `timeout_${timeoutMs}ms` : "",
      stderrText || "",
      error instanceof Error ? buildLogPreview(error.message, 120) : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const errorBlob = `${error?.stdout || ""}\n${error?.stderr || ""}\n${error instanceof Error ? error.message : ""}`;
    const requiresAuth = /Please set an Auth method/i.test(errorBlob);
    logAiInferenceTiming({
      tag: logTag,
      model,
      status: timeout ? "timeout" : "exception",
      elapsedMs,
      detail,
    });
    return {
      value: fallbackValue,
      generatedBy: "fallback",
      warning: timeout
        ? `Gemini CLI 요청 타임아웃(${timeoutMs}ms, elapsed=${elapsedMs}ms)`
        : requiresAuth
          ? buildGeminiAuthWarning()
          : error instanceof Error
            ? error.message
            : "Gemini CLI 처리 중 오류가 발생했습니다.",
    };
  }
};

const callAiJson = async (userPrompt, fallbackValue, options = {}) => {
  const provider = resolveMaterialAiProvider(options.provider);
  if (provider === "gemini_cli") {
    return callGeminiCliJson(userPrompt, fallbackValue, options);
  }
  return callGemmaJson(userPrompt, fallbackValue, options);
};

const TOPIC_DIFFICULTY_SET = new Set(["쉬움", "보통", "어려움"]);

const normalizeOneSentenceTopicTitle = (value) => {
  let text = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\-\*\u2022]+\s*/, "")
    .replace(/^\d+\s*[.)]\s*/, "")
    .replace(/^주제\s*[:：]\s*/i, "")
    .trim();

  if (!text) return "";

  const firstSentence = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean)[0];
  text = String(firstSentence || text).trim();

  if (text.length > 60) {
    const cutIndex = text.lastIndexOf(" ", 60);
    text = (cutIndex > 20 ? text.slice(0, cutIndex) : text.slice(0, 60)).trim();
  }

  return text || "";
};

const normalizeTopicRecommendationsValue = (value) => {
  const sourceRecommendations = Array.isArray(value?.recommendations) ? value.recommendations : [];
  const normalizedRecommendations = [];
  const seenTitle = new Set();

  for (const sourceItem of sourceRecommendations) {
    const title = normalizeOneSentenceTopicTitle(sourceItem?.title);
    if (!title || seenTitle.has(title)) continue;
    seenTitle.add(title);

    const reason = String(sourceItem?.reason || "").trim();
    const discussionQuestions = (Array.isArray(sourceItem?.discussionQuestions) ? sourceItem.discussionQuestions : [])
      .map((question) => String(question || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const difficulty = TOPIC_DIFFICULTY_SET.has(String(sourceItem?.difficulty || "")) ? sourceItem.difficulty : "보통";
    const estimatedTimeRaw = Number.parseInt(String(sourceItem?.estimatedTimeMinutes || ""), 10);
    const estimatedTimeMinutes = Number.isFinite(estimatedTimeRaw) && estimatedTimeRaw > 0 ? estimatedTimeRaw : 15;

    normalizedRecommendations.push({
      title,
      reason,
      discussionQuestions,
      difficulty,
      estimatedTimeMinutes,
    });
    if (normalizedRecommendations.length >= 10) break;
  }

  return {
    recommendations: normalizedRecommendations,
    basisPreview: String(value?.basisPreview || "").slice(0, 400),
  };
};

const buildFeedbackFallback = (summaryText) => ({
  strengths: ["자료의 핵심 내용을 바탕으로 학습 방향을 잡으려는 점이 좋아요."],
  improvements: ["중요 개념을 예시와 연결해 정리하면 이해가 더 선명해질 수 있어요."],
  improvementMethods: [
    "핵심 용어를 3개만 골라 한 문장으로 설명해 보세요.",
    "각 개념마다 실제 사례를 하나씩 붙여 보세요.",
    "친구에게 설명한다고 생각하고 5분 발표문을 만들어 보세요.",
  ],
  nextActions: ["핵심 개념 3개 표시하기", "헷갈리는 질문 2개 적기", "토론 주제 하나를 골라 근거 정리하기"],
  basisPreview: summaryText.slice(0, 400),
});

const DISCUSSION_ISSUE_SEVERITIES = new Set(["low", "medium", "high"]);
const DISCUSSION_REVIEW_WEIGHTS = Object.freeze({
  sourceCoverage: 0.45,
  factAccuracy: 0.2,
  discussionDepth: 0.35,
});

const clampScore = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(Number(fallback) || 0)));
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

const normalizeFixedCountList = (value, targetCount, fallbackItems = []) => {
  const source = Array.isArray(value) ? value : [];
  const deduped = [];
  source.forEach((item) => {
    const text = String(item || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || deduped.includes(text)) return;
    deduped.push(text);
  });

  const fallbackQueue = (Array.isArray(fallbackItems) ? fallbackItems : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  while (deduped.length < targetCount && fallbackQueue.length > 0) {
    const next = fallbackQueue.shift();
    if (next && !deduped.includes(next)) deduped.push(next);
  }

  return deduped.slice(0, targetCount);
};

const buildDiscussionReviewFallback = ({ sourceText, answerText, confirmedTopics }) => {
  const normalizedAnswer = cleanText(answerText);
  const normalizedTopics = (Array.isArray(confirmedTopics) ? confirmedTopics : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const sourceScore = normalizedAnswer ? 58 : 0;
  const factScore = normalizedAnswer ? 56 : 0;
  const discussionScore = normalizedAnswer ? 54 : 0;
  const weighted = Math.round(
    sourceScore * DISCUSSION_REVIEW_WEIGHTS.sourceCoverage +
      factScore * DISCUSSION_REVIEW_WEIGHTS.factAccuracy +
      discussionScore * DISCUSSION_REVIEW_WEIGHTS.discussionDepth,
  );

  return {
    score: weighted,
    sourceCoverageScore: sourceScore,
    factAccuracyScore: factScore,
    discussionDepthScore: discussionScore,
    summary: normalizedAnswer
      ? "자동 평가 결과입니다. AI 응답 품질 저하로 일부 점검만 반영되었습니다."
      : "작성된 답변이 없어 AI 검사를 진행할 수 없습니다.",
    strengths: [
      normalizedTopics.length > 0 ? "확정된 토론 주제를 기준으로 답변을 구성하려는 방향이 보입니다." : "토론을 위한 기본 구조를 시작한 점이 좋습니다.",
      "핵심 키워드를 중심으로 내용을 정리하려는 시도가 있습니다.",
      "문장 단위로 의견을 작성해 토론 확장 가능성이 있습니다.",
    ],
    improvements: [
      "학습자료 문장을 근거로 인용해 주장과 연결하세요.",
      "팩트와 해석을 분리해 근거 신뢰도를 높이세요.",
      "반대 관점 또는 트레이드오프를 1개 이상 추가해 토론 깊이를 높이세요.",
    ],
    issueFeedbacks: [],
    answerLength: normalizedAnswer.length,
    basisPreview: sourceText.slice(0, 400),
  };
};

const normalizeDiscussionReviewValue = (value, fallbackValue) => {
  const fallback = fallbackValue || buildDiscussionReviewFallback({ sourceText: "", answerText: "", confirmedTopics: [] });
  const sourceCoverageScore = clampScore(value?.sourceCoverageScore, fallback.sourceCoverageScore);
  const rawFactAccuracyScore = clampScore(value?.factAccuracyScore, fallback.factAccuracyScore);
  const discussionDepthScore = clampScore(value?.discussionDepthScore, fallback.discussionDepthScore);
  const answerLength = Math.max(0, Number.parseInt(String(value?.answerLength || fallback.answerLength || 0), 10) || 0);
  const summary = String(value?.summary || fallback.summary || "")
    .replace(/\s+/g, " ")
    .trim();
  const strengths = normalizeFixedCountList(value?.strengths, 3, fallback.strengths);
  const improvements = normalizeFixedCountList(value?.improvements, 3, fallback.improvements);

  const rawIssues = Array.isArray(value?.issueFeedbacks) ? value.issueFeedbacks : [];
  const issueFeedbacks = [];
  rawIssues.forEach((item) => {
    const quote = String(item?.quote || item?.sentence || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    const feedback = String(item?.feedback || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    const severityRaw = String(item?.severity || "")
      .trim()
      .toLowerCase();
    const severity = DISCUSSION_ISSUE_SEVERITIES.has(severityRaw) ? severityRaw : "medium";
    if (!quote || !feedback) return;
    issueFeedbacks.push({ quote, feedback, severity });
  });

  const highIssueCount = issueFeedbacks.filter((item) => item.severity === "high").length;
  let factAccuracyScore = rawFactAccuracyScore;
  if (answerLength > 0) {
    if (highIssueCount <= 1) {
      factAccuracyScore = Math.max(rawFactAccuracyScore, 45);
    } else if (highIssueCount <= 3) {
      factAccuracyScore = Math.max(rawFactAccuracyScore, 35);
    } else {
      factAccuracyScore = Math.max(rawFactAccuracyScore, 25);
    }
  }

  const computedScore = Math.round(
    sourceCoverageScore * DISCUSSION_REVIEW_WEIGHTS.sourceCoverage +
      factAccuracyScore * DISCUSSION_REVIEW_WEIGHTS.factAccuracy +
      discussionDepthScore * DISCUSSION_REVIEW_WEIGHTS.discussionDepth,
  );
  const modelScore = Number(value?.score);
  const normalizedModelScore = Number.isFinite(modelScore) ? clampScore(modelScore, computedScore) : null;
  const score = normalizedModelScore == null ? computedScore : Math.max(normalizedModelScore, computedScore);

  return {
    score,
    sourceCoverageScore,
    factAccuracyScore,
    discussionDepthScore,
    summary,
    strengths,
    improvements,
    issueFeedbacks: issueFeedbacks.slice(0, 6),
    answerLength,
    basisPreview: String(value?.basisPreview || fallback.basisPreview || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400),
  };
};

const generateTopicRecommendations = async (sourceText) => {
  const fallback = {
    recommendations: [],
    basisPreview: sourceText.slice(0, 400),
  };
  const compactSource = buildCompactPromptText(sourceText, 2200);
  const prompt = [
    "Below is source text extracted from today's class material.",
    "Generate exactly 10 discussion topics for review.",
    "All output text must be in Korean.",
    "Do not invent facts not present in the source.",
    "Each title must be one Korean sentence only (no numbering, no colon, no extra explanation).",
    "Keep each title concise (recommended 18-40 chars, max 60 chars).",
    'Output JSON schema: {"recommendations":[{"title":"string"}]}',
    "Source text:",
    compactSource,
  ].join("\n\n");
  let lastResult = null;

  for (let attempt = 1; attempt <= GEMMA_TOPIC_RETRY_ATTEMPTS; attempt += 1) {
    const timeoutMs = GEMMA_TOPIC_TIMEOUT_MS + Math.floor((attempt - 1) * 15000);
    const result = await callAiJson(prompt, fallback, {
      timeoutMs,
      temperature: 0.1,
      maxTokens: 900,
      logTag: `topic_recommendation_attempt_${attempt}`,
    });
    const normalizedResult = {
      ...result,
      value: normalizeTopicRecommendationsValue(result.value),
    };
    const isModelSuccess =
      normalizedResult.generatedBy !== "fallback" &&
      !normalizedResult.warning &&
      Array.isArray(normalizedResult.value?.recommendations) &&
      normalizedResult.value.recommendations.length > 0;
    if (isModelSuccess) {
      return normalizedResult;
    }

    lastResult = normalizedResult;
    console.warn(
      `[ai:topic_recommendation] ${resolveMaterialAiLabel()} attempt ${attempt}/${GEMMA_TOPIC_RETRY_ATTEMPTS} failed: ${
        normalizedResult.warning || "unknown"
      }`,
    );
    if (attempt < GEMMA_TOPIC_RETRY_ATTEMPTS && GEMMA_TOPIC_RETRY_DELAY_MS > 0) {
      await sleep(GEMMA_TOPIC_RETRY_DELAY_MS * attempt);
    }
  }

  if (GEMMA_TOPIC_FORCE_MODEL_RESPONSE) {
    return {
      value: {
        recommendations: [],
        basisPreview: sourceText.slice(0, 400),
      },
      generatedBy: "fallback",
      warning: `AI 토론 주제 생성을 ${GEMMA_TOPIC_RETRY_ATTEMPTS}회 시도했지만 실패했습니다. 잠시 후 다시 시도해주세요.`,
    };
  }

  return (
    lastResult || {
      value: normalizeTopicRecommendationsValue(fallback),
      generatedBy: "fallback",
      warning: "Gemma 응답이 없습니다.",
    }
  );
};

const generateLearningFeedback = async (sourceText) => {
  const fallback = buildFeedbackFallback(sourceText);
  const compactSource = buildCompactPromptText(sourceText, 2200);
  const prompt = [
    "Based on the source text below, write learning feedback for a student.",
    "All output text must be in Korean.",
    "Include strengths, improvements, practical improvement methods, and 3 next actions.",
    'Output JSON schema: {"strengths":["string"],"improvements":["string"],"improvementMethods":["string"],"nextActions":["string"]}',
    "Source text:",
    compactSource,
  ].join("\n\n");
  return callAiJson(prompt, fallback, {
    timeoutMs: GEMMA_FEEDBACK_TIMEOUT_MS,
    temperature: 0.1,
    maxTokens: 900,
    logTag: "learning_feedback",
  });
};

const generateDiscussionReview = async ({ sourceText, answerText, confirmedTopics = [] }) => {
  const fallback = buildDiscussionReviewFallback({ sourceText, answerText, confirmedTopics });
  const compactSource = buildCompactPromptText(sourceText, 2400);
  const compactAnswer = buildCompactPromptText(answerText, 2200);
  const compactTopics = (Array.isArray(confirmedTopics) ? confirmedTopics : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .join(" | ");

  const prompt = [
    "You are a fair Korean study discussion evaluator.",
    "Evaluate only with evidence from the source material and the student's answer.",
    "Do NOT invent facts outside the source.",
    "Use lenient fact-checking unless there is a clear contradiction or fabricated claim.",
    "When uncertain, do not over-penalize factual score.",
    "All output text must be in Korean.",
    "Return JSON only.",
    'Required JSON schema: {"score":number,"sourceCoverageScore":number,"factAccuracyScore":number,"discussionDepthScore":number,"summary":"string","strengths":["string","string","string"],"improvements":["string","string","string"],"issueFeedbacks":[{"quote":"string","feedback":"string","severity":"high|medium|low"}],"answerLength":number}',
    "Scoring guide:",
    "- sourceCoverageScore: how well the answer uses today's source material.",
    "- factAccuracyScore: penalize mainly for clear factual contradiction/fabrication. Missing detail or vague wording should be mild penalty.",
    "- discussionDepthScore: reasoning quality, trade-offs, and discussion maturity.",
    "- score: weighted total (45% sourceCoverage, 20% factAccuracy, 35% discussionDepth).",
    "strengths must be exactly 3 points.",
    "improvements must be exactly 3 points.",
    "issueFeedbacks should include only problematic quotes from the student's answer (max 6).",
    "",
    `Confirmed topics: ${compactTopics || "(없음)"}`,
    "Source material:",
    compactSource,
    "",
    "Student answer:",
    compactAnswer,
  ].join("\n");

  const result = await callAiJson(prompt, fallback, {
    timeoutMs: Math.max(GEMMA_FEEDBACK_TIMEOUT_MS, 90000),
    temperature: 0.1,
    maxTokens: 1200,
    logTag: "discussion_review",
  });

  return {
    ...result,
    value: normalizeDiscussionReviewValue(result.value, fallback),
  };
};

const mapMaterialRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  originalFileName: normalizeOriginalFileName(row.original_file_name),
  fileUrl: row.file_url,
  fileType: row.file_type,
  mimeType: row.mime_type,
  fileSize: Number(row.file_size || 0),
  status: row.status,
  errorMessage: row.error_message || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fetchMaterialForUser = async (materialId, userId) => {
  const [rows] = await pool.query(`SELECT * FROM uploaded_materials WHERE id = ? AND user_id = ? LIMIT 1`, [
    materialId,
    userId,
  ]);
  return rows[0] || null;
};

const buildMaterialPipelineOutputDir = (materialId) => path.join(MATERIAL_PIPELINE_OUTPUT_DIR, String(materialId));

const buildExtractedTextFromPageAnalyses = (analyses) => {
  const rows = (Array.isArray(analyses) ? analyses : [])
    .sort((a, b) => Number(a?.page_number || 0) - Number(b?.page_number || 0))
    .map((page) => {
      const lines = [];
      const title = String(page?.title || "").trim();
      if (title) lines.push(title);
      (Array.isArray(page?.main_points) ? page.main_points : []).forEach((item) => {
        const value = String(item || "").trim();
        if (value) lines.push(`- ${value}`);
      });
      (Array.isArray(page?.facts) ? page.facts : []).forEach((item) => {
        const value = String(item || "").trim();
        if (value) lines.push(`- 사실: ${value}`);
      });
      (Array.isArray(page?.interpretations) ? page.interpretations : []).forEach((item) => {
        const value = String(item || "").trim();
        if (value) lines.push(`- 해석: ${value}`);
      });
      return lines.join("\n").trim();
    })
    .filter(Boolean);

  return cleanText(rows.join("\n\n"));
};

const loadVisionPipelinePagesForMaterial = async (materialId) => {
  const pagesDir = path.join(buildMaterialPipelineOutputDir(materialId), "pages");
  const files = (await fs.readdir(pagesDir).catch(() => []))
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) return [];

  const pages = [];
  for (const fileName of files) {
    const filePath = path.join(pagesDir, fileName);
    const parsed = await fs
      .readFile(filePath, "utf8")
      .then((raw) => JSON.parse(raw))
      .catch(() => null);
    if (!parsed || typeof parsed !== "object") continue;

    const pageNo = Number.parseInt(String(parsed.page_number || ""), 10);
    if (!Number.isInteger(pageNo) || pageNo <= 0) continue;

    const lines = [];
    const title = String(parsed.title || "").trim();
    if (title) lines.push(title);
    (Array.isArray(parsed.main_points) ? parsed.main_points : []).forEach((item) => {
      const value = String(item || "").trim();
      if (value) lines.push(`- ${value}`);
    });
    (Array.isArray(parsed.facts) ? parsed.facts : []).forEach((item) => {
      const value = String(item || "").trim();
      if (value) lines.push(`- 사실: ${value}`);
    });
    (Array.isArray(parsed.interpretations) ? parsed.interpretations : []).forEach((item) => {
      const value = String(item || "").trim();
      if (value) lines.push(`- 해석: ${value}`);
    });
    (Array.isArray(parsed.discussion_candidates) ? parsed.discussion_candidates : []).forEach((item) => {
      const value = String(item || "").trim();
      if (value) lines.push(`- 토론: ${value}`);
    });

    const pageText = cleanText(lines.join("\n"));
    pages.push({
      pageNo,
      rawText: pageText || null,
      ocrText: pageText || null,
    });
  }

  return pages.sort((a, b) => a.pageNo - b.pageNo);
};

const processMaterialLegacy = async (material, fileBuffer, options = {}) => {
  const withAi = options.withAi !== false;
  await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = NULL WHERE id = ?`, [
    MATERIAL_STATUS.PROCESSING,
    material.id,
  ]);
  notifyMaterialStatus({
    materialId: material.id,
    userId: material.user_id,
    status: MATERIAL_STATUS.PROCESSING,
    errorMessage: null,
    progressPercent: 5,
    stage: "queued",
    message: "OCR 처리를 시작합니다.",
  });

  try {
    const extracted = await extractMaterialText(material.file_type, material.storage_path, fileBuffer, {
      onProgress: (progressPayload) => {
        notifyMaterialStatus({
          materialId: material.id,
          userId: material.user_id,
          status: MATERIAL_STATUS.PROCESSING,
          errorMessage: null,
          ...progressPayload,
        });
      },
    });
    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: MATERIAL_STATUS.PROCESSING,
      errorMessage: null,
      progressPercent: 94,
      stage: "persisting",
      message: "추출된 OCR 결과를 저장하고 있습니다.",
      processedPages: extracted.pages.length || 1,
      totalPages: extracted.pages.length || 1,
    });

    const extractedText = cleanText(extracted.text);
    const pagePreview = extracted.pages.slice(0, 5).map((page) => ({
      pageNo: page.pageNo,
      rawLength: String(page.rawText || "").length,
      ocrLength: String(page.ocrText || "").length,
      rawPreview: buildLogPreview(page.rawText, 120),
      ocrPreview: buildLogPreview(page.ocrText, 120),
    }));
    console.info(
      `[material:${material.id}] OCR extracted method=${extracted.extractionMethod} pages=${extracted.pages.length} textLength=${extractedText.length}`,
    );
    if (pagePreview.length > 0) {
      console.info(`[material:${material.id}] OCR page preview: ${JSON.stringify(pagePreview)}`);
    }
    console.info(`[material:${material.id}] OCR text preview: ${buildLogPreview(extractedText, 600)}`);

    if (!extractedText) {
      const emptyExtractionMessage =
        "텍스트 추출 결과가 비어 있습니다. 스캔 자료라면 OCR 도구(pdftoppm, tesseract kor+eng) 또는 텍스트가 포함된 파일이 필요합니다.";
      await pool.query(`UPDATE uploaded_materials SET status = ?, extracted_text = '', error_message = ? WHERE id = ?`, [
        MATERIAL_STATUS.FAILED,
        emptyExtractionMessage,
        material.id,
      ]);
      notifyMaterialStatus({
        materialId: material.id,
        userId: material.user_id,
        status: MATERIAL_STATUS.FAILED,
        errorMessage: emptyExtractionMessage,
        progressPercent: 100,
        stage: "failed",
        message: "OCR에서 텍스트를 추출하지 못했습니다.",
      });
      notifyUser({
        userId: material.user_id,
        type: "ocr_failed",
        title: "OCR 처리 실패",
        message: "업로드한 자료에서 텍스트를 추출하지 못했습니다. 파일을 확인하고 다시 업로드해주세요.",
        linkUrl: "/study-room",
        payload: { materialId: material.id },
      });
      return {
        status: MATERIAL_STATUS.FAILED,
        extractionMethod: extracted.extractionMethod,
        topicRecommendation: null,
        feedback: null,
      };
    }

    await pool.query(`UPDATE uploaded_materials SET extracted_text = ? WHERE id = ?`, [extractedText, material.id]);

    if (!withAi) {
      await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = NULL WHERE id = ?`, [
        MATERIAL_STATUS.COMPLETED,
        material.id,
      ]);
      notifyMaterialStatus({
        materialId: material.id,
        userId: material.user_id,
        status: MATERIAL_STATUS.COMPLETED,
        errorMessage: null,
        progressPercent: 100,
        stage: "completed",
        message: "OCR 처리가 완료되었습니다.",
        processedPages: extracted.pages.length || 1,
        totalPages: extracted.pages.length || 1,
      });
      notifyUser({
        userId: material.user_id,
        type: "ocr_completed",
        title: "OCR 처리 완료",
        message: "업로드한 자료의 OCR 처리가 완료되었습니다.",
        linkUrl: "/study-room",
        payload: { materialId: material.id },
      });
      return {
        status: MATERIAL_STATUS.COMPLETED,
        extractionMethod: extracted.extractionMethod,
        summaryCount: 0,
        topicRecommendation: null,
        feedback: null,
      };
    }

    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: MATERIAL_STATUS.PROCESSING,
      errorMessage: null,
      progressPercent: 99,
      stage: "ai_processing",
      message: MATERIAL_AI_ENABLE_FEEDBACK
        ? "OCR가 완료되었습니다. AI 주제/피드백 분석을 진행 중입니다."
        : "OCR가 완료되었습니다. AI 주제 분석을 진행 중입니다.",
      processedPages: extracted.pages.length || 1,
      totalPages: extracted.pages.length || 1,
    });

    await pool.query(`DELETE FROM material_summaries WHERE material_id = ?`, [material.id]);
    const topicResult = await generateTopicRecommendations(extractedText);
    const feedbackResult = MATERIAL_AI_ENABLE_FEEDBACK ? await generateLearningFeedback(extractedText) : null;

    const topicJson = {
      ...topicResult.value,
      generatedBy: topicResult.generatedBy,
      warning: topicResult.warning,
    };
    const feedbackJson = feedbackResult
      ? {
          ...feedbackResult.value,
          generatedBy: feedbackResult.generatedBy,
          warning: feedbackResult.warning,
        }
      : null;

    await pool.query(`INSERT INTO ${MATERIAL_TOPIC_RECOMMENDATIONS_TABLE} (material_id, user_id, result_json) VALUES (?, ?, ?)`, [
      material.id,
      material.user_id,
      JSON.stringify(topicJson),
    ]);
    if (feedbackJson) {
      await pool.query(`INSERT INTO ${MATERIAL_FEEDBACKS_TABLE} (material_id, user_id, result_json) VALUES (?, ?, ?)`, [
        material.id,
        material.user_id,
        JSON.stringify(feedbackJson),
      ]);
    }

    const finalStatus =
      topicResult.generatedBy === "fallback" || (feedbackResult && feedbackResult.generatedBy === "fallback")
        ? MATERIAL_STATUS.AI_UNAVAILABLE
        : MATERIAL_STATUS.COMPLETED;
    const finalWarning = topicResult.warning || (feedbackResult ? feedbackResult.warning : null) || null;
    await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = ? WHERE id = ?`, [
      finalStatus,
      finalWarning,
      material.id,
    ]);
    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: finalStatus,
      errorMessage: finalWarning,
      progressPercent: 100,
      stage: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE ? "ai_unavailable" : "completed",
      message: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE
        ? "OCR는 완료되었지만 AI 분석 일부가 제한됩니다."
        : MATERIAL_AI_ENABLE_FEEDBACK
          ? "OCR 및 AI 분석이 완료되었습니다."
          : "OCR 및 AI 주제 분석이 완료되었습니다.",
      processedPages: extracted.pages.length || 1,
      totalPages: extracted.pages.length || 1,
    });
    notifyUser({
      userId: material.user_id,
      type: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE ? "ocr_ai_limited" : "ocr_ai_completed",
      title: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE ? "OCR 완료 (AI 일부 제한)" : "OCR 및 AI 분석 완료",
      message:
        finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE
          ? "OCR은 완료되었지만 AI 분석 일부가 제한되었습니다. 다시 시도해보세요."
          : "OCR과 토론 주제 분석이 완료되었습니다.",
      linkUrl: "/study-room",
      payload: { materialId: material.id },
    });

    return {
      status: finalStatus,
      extractionMethod: extracted.extractionMethod,
      summaryCount: 0,
      topicRecommendation: topicJson,
      feedback: feedbackJson,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "자료 처리 중 알 수 없는 오류가 발생했습니다.";
    await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = ? WHERE id = ?`, [
      MATERIAL_STATUS.FAILED,
      message,
      material.id,
    ]);
    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: MATERIAL_STATUS.FAILED,
      errorMessage: message,
      progressPercent: 100,
      stage: "failed",
      message: "OCR 처리 중 오류가 발생했습니다.",
    });
    notifyUser({
      userId: material.user_id,
      type: "ocr_failed",
      title: "OCR 처리 실패",
      message: "OCR 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      linkUrl: "/study-room",
      payload: { materialId: material.id },
    });
    throw error;
  }
};

const processMaterialWithOcrPipeline = async (material, options = {}) => {
  const withAi = options.withAi !== false;
  const suppressFailureNotification = options.suppressFailureNotification === true;
  const pipelineOutputDir = buildMaterialPipelineOutputDir(material.id);
  const pageConcurrency = Math.max(
    1,
    resolveConcurrency(
      process.env.MATERIAL_PIPELINE_PAGE_CONCURRENCY,
      process.env.MATERIAL_LEGACY_OCR_CONCURRENCY,
      process.env.OCR_CONCURRENCY,
      OCR_CONCURRENCY,
    ),
  );
  const pipelineDpi = Math.max(120, Number.parseInt(String(process.env.MATERIAL_PIPELINE_DPI || ""), 10) || 180);
  const ocrLanguage = String(process.env.MATERIAL_PIPELINE_OCR_LANGUAGE || "kor+eng").trim() || "kor+eng";

  const logger = {
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    debug: (...args) => {
      if (String(process.env.MATERIAL_PIPELINE_VERBOSE || "").toLowerCase() === "true") {
        console.info("[pipeline:debug]", ...args);
      }
    },
  };

  await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = NULL WHERE id = ?`, [
    MATERIAL_STATUS.PROCESSING,
    material.id,
  ]);
  notifyMaterialStatus({
    materialId: material.id,
    userId: material.user_id,
    status: MATERIAL_STATUS.PROCESSING,
    errorMessage: null,
    progressPercent: 5,
    stage: "ocr_pipeline_queued",
    message: "OCR-only 페이지 분석을 시작합니다.",
  });
  logger.info(`[pipeline] page analysis concurrency=${pageConcurrency} mode=ocr-only`);

  try {
    await fs.rm(pipelineOutputDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(pipelineOutputDir, { recursive: true });
    const prompts = await loadAllPrompts();

    let latestProcessedPages = 0;
    let latestTotalPages = 1;
    const pageStage = await runPageAnalysisStage({
      inputPdfPath: material.storage_path,
      outputDir: pipelineOutputDir,
      prompts,
      adapter: null,
      logger,
      dpi: pipelineDpi,
      concurrency: pageConcurrency,
      skipExisting: false,
      ocrLanguage,
      overwriteImages: true,
      forceOcrAllPages: true,
      onPageAnalyzed: ({ processedPages, totalPages }) => {
        latestProcessedPages = Math.max(0, Number(processedPages) || 0);
        latestTotalPages = Math.max(1, Number(totalPages) || 1);
        const progressPercent = Math.max(10, Math.min(75, 10 + Math.floor((latestProcessedPages / latestTotalPages) * 65)));
        notifyMaterialStatus({
          materialId: material.id,
          userId: material.user_id,
          status: MATERIAL_STATUS.PROCESSING,
          errorMessage: null,
          progressPercent,
          stage: "ocr_page_analysis",
          message: `OCR 페이지를 분석 중입니다. (${latestProcessedPages}/${latestTotalPages})`,
          processedPages: latestProcessedPages,
          totalPages: latestTotalPages,
        });
      },
    });

    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: MATERIAL_STATUS.PROCESSING,
      errorMessage: null,
      progressPercent: 86,
      stage: "discussion_topics",
      message: "추출 텍스트를 기반으로 토론 주제를 생성 중입니다.",
      processedPages: latestProcessedPages || pageStage.pageCount || 1,
      totalPages: latestTotalPages || pageStage.pageCount || 1,
    });

    const extractedText = buildExtractedTextFromPageAnalyses(pageStage.analyses);
    if (!extractedText) {
      throw new Error("OCR 파이프라인에서 유효한 텍스트를 추출하지 못했습니다.");
    }
    await pool.query(`UPDATE uploaded_materials SET extracted_text = ? WHERE id = ?`, [extractedText, material.id]);

    if (!withAi) {
      await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = NULL WHERE id = ?`, [
        MATERIAL_STATUS.COMPLETED,
        material.id,
      ]);
      notifyMaterialStatus({
        materialId: material.id,
        userId: material.user_id,
        status: MATERIAL_STATUS.COMPLETED,
        errorMessage: null,
        progressPercent: 100,
        stage: "completed",
        message: "OCR 처리가 완료되었습니다.",
        processedPages: latestProcessedPages || pageStage.pageCount || 1,
        totalPages: latestTotalPages || pageStage.pageCount || 1,
      });
      notifyUser({
        userId: material.user_id,
        type: "ocr_completed",
        title: "OCR 처리 완료",
        message: "업로드한 자료의 OCR 처리가 완료되었습니다.",
        linkUrl: "/study-room",
        payload: { materialId: material.id },
      });
      return {
        status: MATERIAL_STATUS.COMPLETED,
        extractionMethod: "ocr-only",
        summaryCount: 0,
        topicRecommendation: null,
        feedback: null,
      };
    }

    await pool.query(`DELETE FROM material_summaries WHERE material_id = ?`, [material.id]);
    const topicResult = await generateTopicRecommendations(extractedText);
    const feedbackResult = MATERIAL_AI_ENABLE_FEEDBACK ? await generateLearningFeedback(extractedText) : null;
    const topicJson = {
      ...topicResult.value,
      generatedBy: topicResult.generatedBy,
      warning: topicResult.warning,
    };
    const feedbackJson = feedbackResult
      ? {
          ...feedbackResult.value,
          generatedBy: feedbackResult.generatedBy,
          warning: feedbackResult.warning,
        }
      : null;

    await pool.query(`INSERT INTO ${MATERIAL_TOPIC_RECOMMENDATIONS_TABLE} (material_id, user_id, result_json) VALUES (?, ?, ?)`, [
      material.id,
      material.user_id,
      JSON.stringify(topicJson),
    ]);
    if (feedbackJson) {
      await pool.query(`INSERT INTO ${MATERIAL_FEEDBACKS_TABLE} (material_id, user_id, result_json) VALUES (?, ?, ?)`, [
        material.id,
        material.user_id,
        JSON.stringify(feedbackJson),
      ]);
    }

    const finalStatus =
      topicResult.generatedBy === "fallback" || (feedbackResult && feedbackResult.generatedBy === "fallback")
        ? MATERIAL_STATUS.AI_UNAVAILABLE
        : MATERIAL_STATUS.COMPLETED;
    const finalWarning = topicResult.warning || (feedbackResult ? feedbackResult.warning : null) || null;
    await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = ? WHERE id = ?`, [
      finalStatus,
      finalWarning,
      material.id,
    ]);
    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: finalStatus,
      errorMessage: finalWarning,
      progressPercent: 100,
      stage: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE ? "ai_unavailable" : "completed",
      message:
        finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE
          ? "OCR 처리는 완료되었지만 AI 분석 일부가 제한됩니다."
          : MATERIAL_AI_ENABLE_FEEDBACK
            ? "OCR-only 분석과 토론 주제/피드백 생성이 완료되었습니다."
            : "OCR-only 분석과 토론 주제 생성이 완료되었습니다.",
      processedPages: latestProcessedPages || pageStage.pageCount || 1,
      totalPages: latestTotalPages || pageStage.pageCount || 1,
    });
    notifyUser({
      userId: material.user_id,
      type: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE ? "ocr_ai_limited" : "ocr_ai_completed",
      title: finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE ? "OCR 완료 (AI 일부 제한)" : "OCR 및 AI 분석 완료",
      message:
        finalStatus === MATERIAL_STATUS.AI_UNAVAILABLE
          ? "OCR은 완료되었지만 AI 분석 일부가 제한되었습니다. 다시 시도해보세요."
          : "OCR과 토론 주제 분석이 완료되었습니다.",
      linkUrl: "/study-room",
      payload: { materialId: material.id },
    });

    return {
      status: finalStatus,
      extractionMethod: "ocr-only",
      summaryCount: 0,
      topicRecommendation: topicJson,
      feedback: feedbackJson,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR 파이프라인 처리 중 오류가 발생했습니다.";
    await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = ? WHERE id = ?`, [
      MATERIAL_STATUS.FAILED,
      message,
      material.id,
    ]);
    notifyMaterialStatus({
      materialId: material.id,
      userId: material.user_id,
      status: MATERIAL_STATUS.FAILED,
      errorMessage: message,
      progressPercent: 100,
      stage: "failed",
      message: "OCR-only 파이프라인 처리 중 오류가 발생했습니다.",
    });
    if (!suppressFailureNotification) {
      notifyUser({
        userId: material.user_id,
        type: "ocr_failed",
        title: "OCR 처리 실패",
        message: "OCR 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        linkUrl: "/study-room",
        payload: { materialId: material.id },
      });
    }
    throw error;
  }
};

const processMaterial = async (material, fileBuffer, options = {}) => {
  if (String(material?.file_type || "").toLowerCase() !== "pdf") {
    return processMaterialLegacy(material, fileBuffer, options);
  }

  try {
    return await processMaterialWithOcrPipeline(material, { ...options, suppressFailureNotification: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[material:${material.id}] OCR pipeline failed, fallback to legacy: ${message}`);
    return processMaterialLegacy(material, fileBuffer, options);
  }
};

const uploadMaterial = async (req) => {
  await ensureMaterialSchema();
  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  if (!req.file) {
    return { status: 400, body: { message: "업로드할 PDF/PPT/PPTX 자료를 선택해주세요." } };
  }

  const normalizedOriginalName = normalizeOriginalFileName(req.file.originalname);
  const fileType = resolveFileType(req.file, normalizedOriginalName);
  if (!fileType) {
    return { status: 400, body: { message: "지원하지 않는 자료 형식입니다. pdf, ppt, pptx만 가능합니다." } };
  }

  const saved = await saveMaterialFile(req.file, normalizedOriginalName);
  const [insertResult] = await pool.query(
    `INSERT INTO uploaded_materials (
      user_id, original_file_name, file_url, storage_path, file_type, mime_type, file_size, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      currentUser.user.id,
      normalizedOriginalName,
      saved.fileUrl,
      saved.storagePath,
      fileType,
      req.file.mimetype,
      req.file.size,
      MATERIAL_STATUS.UPLOADED,
    ],
  );

  const [rows] = await pool.query(`SELECT * FROM uploaded_materials WHERE id = ?`, [insertResult.insertId]);
  const material = rows[0];

  await pool.query(`UPDATE uploaded_materials SET status = ?, error_message = NULL WHERE id = ?`, [
    MATERIAL_STATUS.PROCESSING,
    material.id,
  ]);
  notifyMaterialStatus({
    materialId: material.id,
    userId: material.user_id,
    status: MATERIAL_STATUS.PROCESSING,
    errorMessage: null,
    progressPercent: 1,
    stage: "uploaded",
    message: "업로드를 완료했습니다. Vision/OCR 분석 대기열에 등록합니다.",
  });
  const queuedMaterial = { ...material, status: MATERIAL_STATUS.PROCESSING, error_message: null };

  setImmediate(() => {
    processMaterial(queuedMaterial, req.file.buffer, { withAi: true }).catch((error) => {
      const message = error instanceof Error ? error.message : "자료 OCR 백그라운드 처리 중 오류가 발생했습니다.";
      console.error(`[material:${queuedMaterial.id}] background OCR failed: ${message}`);
    });
  });

  return {
    status: 202,
    body: {
      message: "자료 업로드를 완료했습니다. Vision/OCR 및 AI 분석을 진행 중입니다.",
      material: mapMaterialRow(queuedMaterial),
      processing: {
        status: MATERIAL_STATUS.PROCESSING,
        queued: true,
      },
    },
  };
};

const listMaterials = async (req) => {
  await ensureMaterialSchema();
  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  const [rows] = await pool.query(
    `SELECT * FROM uploaded_materials WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    [currentUser.user.id],
  );

  return {
    status: 200,
    body: { message: "업로드 자료 목록입니다.", materials: rows.map(mapMaterialRow) },
  };
};

const getMaterialDetail = async (req) => {
  await ensureMaterialSchema();
  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  const materialId = toPositiveInt(req.params.materialId);
  if (!materialId) {
    return { status: 400, body: { message: "자료 ID를 확인해주세요." } };
  }

  const material = await fetchMaterialForUser(materialId, currentUser.user.id);
  if (!material) {
    return { status: 404, body: { message: "자료를 찾을 수 없습니다." } };
  }

  const extractedText = String(material.extracted_text || "").trim();
  let pages = [];
  if (String(material.file_type || "").toLowerCase() === "pdf") {
    pages = await loadVisionPipelinePagesForMaterial(materialId);
  }
  if (pages.length === 0 && extractedText) {
    pages = [{ pageNo: 1, rawText: null, ocrText: extractedText }];
  }
  if (pages.length === 0) {
    const [legacyPages] = await pool.query(
      `SELECT page_no, raw_text, ocr_text FROM material_pages WHERE material_id = ? ORDER BY page_no ASC`,
      [materialId],
    );
    pages = legacyPages.map((page) => ({
      pageNo: page.page_no,
      rawText: page.raw_text,
      ocrText: page.ocr_text,
    }));
  }
  const [summaries] = await pool.query(
    `SELECT chunk_index, summary_text, created_at FROM material_summaries WHERE material_id = ? ORDER BY chunk_index ASC`,
    [materialId],
  );
  const [topics] = await pool.query(
    `SELECT id, result_json, created_at FROM ${MATERIAL_TOPIC_RECOMMENDATIONS_TABLE} WHERE material_id = ? ORDER BY created_at DESC`,
    [materialId],
  );
  const [feedbacks] = await pool.query(
    `SELECT id, result_json, created_at FROM ${MATERIAL_FEEDBACKS_TABLE} WHERE material_id = ? ORDER BY created_at DESC`,
    [materialId],
  );

  return {
    status: 200,
    body: {
      message: "자료 상세 정보입니다.",
      material: mapMaterialRow(material),
      pages,
      summaries: summaries.map((summary) => ({
        chunkIndex: summary.chunk_index,
        summaryText: summary.summary_text,
        createdAt: summary.created_at,
      })),
      topicRecommendations: topics.map((topic) => ({
        id: topic.id,
        result: JSON.parse(topic.result_json),
        createdAt: topic.created_at,
      })),
      feedbacks: feedbacks.map((feedback) => ({
        id: feedback.id,
        result: JSON.parse(feedback.result_json),
        createdAt: feedback.created_at,
      })),
    },
  };
};

const analyzeMaterial = async (req) => {
  await ensureMaterialSchema();
  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  const materialId = toPositiveInt(req.params.materialId);
  if (!materialId) {
    return { status: 400, body: { message: "자료 ID를 확인해주세요." } };
  }

  const material = await fetchMaterialForUser(materialId, currentUser.user.id);
  if (!material) {
    return { status: 404, body: { message: "자료를 찾을 수 없습니다." } };
  }

  if ([MATERIAL_STATUS.UPLOADED, MATERIAL_STATUS.PROCESSING].includes(String(material.status || ""))) {
    return { status: 409, body: { message: "OCR 처리가 아직 진행 중입니다. 잠시 후 다시 시도해주세요." } };
  }

  const extractedText = cleanText(material.extracted_text);
  if (!extractedText) {
    return { status: 400, body: { message: "분석할 텍스트가 없습니다. 자료를 다시 업로드해주세요." } };
  }

  await pool.query(`DELETE FROM material_summaries WHERE material_id = ?`, [material.id]);
  const analysisType = String(req.body.analysisType || "topic").toLowerCase();
  if (!MATERIAL_AI_ENABLE_FEEDBACK && analysisType === "feedback") {
    return { status: 400, body: { message: "현재 학습 피드백 생성은 비활성화되어 있습니다. 주제 추천만 사용할 수 있습니다." } };
  }
  if (!["topic", "feedback", "all", "review"].includes(analysisType)) {
    return { status: 400, body: { message: "지원하지 않는 분석 타입입니다." } };
  }
  const body = { message: "AI 분석이 완료되었습니다." };
  const shouldAnalyzeTopic = analysisType === "all" || analysisType === "topic";
  const shouldAnalyzeFeedback = MATERIAL_AI_ENABLE_FEEDBACK && (analysisType === "feedback" || analysisType === "all");
  const shouldAnalyzeReview = analysisType === "review";

  if (shouldAnalyzeTopic) {
    const topicResult = await generateTopicRecommendations(extractedText);
    const topicJson = { ...topicResult.value, generatedBy: topicResult.generatedBy, warning: topicResult.warning };
    await pool.query(`INSERT INTO ${MATERIAL_TOPIC_RECOMMENDATIONS_TABLE} (material_id, user_id, result_json) VALUES (?, ?, ?)`, [
      material.id,
      currentUser.user.id,
      JSON.stringify(topicJson),
    ]);
    body.topicRecommendation = topicJson;
  }

  if (shouldAnalyzeFeedback) {
    const feedbackResult = await generateLearningFeedback(extractedText);
    const feedbackJson = { ...feedbackResult.value, generatedBy: feedbackResult.generatedBy, warning: feedbackResult.warning };
    await pool.query(`INSERT INTO ${MATERIAL_FEEDBACKS_TABLE} (material_id, user_id, result_json) VALUES (?, ?, ?)`, [
      material.id,
      currentUser.user.id,
      JSON.stringify(feedbackJson),
    ]);
    body.feedback = feedbackJson;
  }

  if (shouldAnalyzeReview) {
    const answerText = cleanText(req.body.answerText || req.body.answer || "");
    const confirmedTopics = (Array.isArray(req.body.confirmedTopics) ? req.body.confirmedTopics : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 10);
    const reviewNotificationLink = normalizeNotificationLink(req.body.notificationLink) || "/study-room";

    if (!answerText) {
      return { status: 400, body: { message: "AI 검사할 답변 텍스트가 필요합니다." } };
    }

    const reviewResult = await generateDiscussionReview({
      sourceText: extractedText,
      answerText,
      confirmedTopics,
    });
    const reviewJson = { ...reviewResult.value, generatedBy: reviewResult.generatedBy, warning: reviewResult.warning };
    body.review = reviewJson;
    notifyUser({
      userId: currentUser.user.id,
      type: "ai_review_completed",
      title: "AI 검사 완료",
      message: "토론 답변 AI 검사가 완료되었습니다. 점수와 피드백을 확인해주세요.",
      linkUrl: reviewNotificationLink,
      payload: { materialId: material.id, score: reviewJson.score || null },
    });
  }

  return { status: 200, body };
};

module.exports = {
  uploadMaterial,
  listMaterials,
  getMaterialDetail,
  analyzeMaterial,
};
