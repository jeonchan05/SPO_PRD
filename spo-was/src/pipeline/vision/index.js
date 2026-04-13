const { createMockVisionAdapter } = require("./mock.adapter");
const { createOpenAiCompatibleAdapter } = require("./openai-compatible.adapter");
const { createGeminiCliAdapter } = require("./gemini-cli.adapter");

const DEFAULT_GEMMA_API_BASE_URL = "http://127.0.0.1:11434";

const DEFAULT_SYSTEM_PROMPT = [
  "당신은 한국어로 답하는 발표자료 분석 보조 모델입니다.",
  "자료에 없는 내용을 창작하지 말고, 근거가 없으면 빈 배열 또는 낮은 confidence로 응답하세요.",
  "반드시 JSON으로만 응답하세요.",
].join(" ");

const resolveBaseUrl = (raw) => {
  const normalized = String(raw || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
};

const resolveTimeoutMs = (config = {}) => {
  const raw =
    config.timeoutMs ||
    process.env.MODEL_REQUEST_TIMEOUT_MS ||
    process.env.GEMMA_REQUEST_TIMEOUT_MS ||
    process.env.MATERIAL_PIPELINE_REQUEST_TIMEOUT_MS ||
    "";
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 300000;
};

const resolvePageTimeoutMs = (config = {}) => {
  const raw =
    config.pageTimeoutMs ||
    process.env.MODEL_PAGE_TIMEOUT_MS ||
    process.env.GEMMA_PAGE_TIMEOUT_MS ||
    process.env.MATERIAL_PIPELINE_PAGE_TIMEOUT_MS ||
    "";
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 45000;
};

const resolveSummaryTimeoutMs = (config = {}) => {
  const raw =
    config.summaryTimeoutMs ||
    process.env.MODEL_SUMMARY_TIMEOUT_MS ||
    process.env.GEMMA_SUMMARY_TIMEOUT_MS ||
    process.env.MATERIAL_PIPELINE_SUMMARY_TIMEOUT_MS ||
    "";
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return resolveTimeoutMs(config);
};

const resolveTopicsTimeoutMs = (config = {}) => {
  const raw =
    config.topicsTimeoutMs ||
    process.env.MODEL_TOPICS_TIMEOUT_MS ||
    process.env.GEMMA_TOPICS_TIMEOUT_MS ||
    process.env.MATERIAL_PIPELINE_TOPICS_TIMEOUT_MS ||
    "";
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return resolveTimeoutMs(config);
};

const createVisionAdapter = (config = {}) => {
  const rawBaseUrl =
    config.baseUrl ||
    process.env.MODEL_BASE_URL ||
    process.env.GEMMA_API_BASE_URL ||
    process.env.OPENAI_COMPATIBLE_API_BASE_URL ||
    DEFAULT_GEMMA_API_BASE_URL;
  const provider = String(config.provider || process.env.MODEL_PROVIDER || (rawBaseUrl ? "gemma_api" : "mock"))
    .trim()
    .toLowerCase();

  if (provider === "openai_compatible" || provider === "openai" || provider === "gemma_api") {
    return createOpenAiCompatibleAdapter({
      baseUrl: resolveBaseUrl(rawBaseUrl),
      apiKey: String(config.apiKey || process.env.API_KEY || process.env.GEMMA_API_KEY || "").trim(),
      model: String(config.model || process.env.MODEL_NAME || process.env.GEMMA_MODEL || "gemma4:e4b").trim(),
      systemPrompt: String(config.systemPrompt || process.env.MODEL_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT).trim(),
      timeoutMs: resolveTimeoutMs(config),
      pageTimeoutMs: resolvePageTimeoutMs(config),
      summaryTimeoutMs: resolveSummaryTimeoutMs(config),
      topicsTimeoutMs: resolveTopicsTimeoutMs(config),
    });
  }

  if (provider === "gemini_cli" || provider === "gemini-cli" || provider === "gemini") {
    return createGeminiCliAdapter({
      model: String(config.model || process.env.MODEL_NAME || process.env.GEMINI_CLI_MODEL || "gemini-2.5-flash").trim(),
      timeoutMs: resolveTimeoutMs(config),
      pageTimeoutMs: resolvePageTimeoutMs(config),
      summaryTimeoutMs: resolveSummaryTimeoutMs(config),
      topicsTimeoutMs: resolveTopicsTimeoutMs(config),
      command: String(config.command || process.env.GEMINI_CLI_BIN || "gemini").trim(),
      nodeBin: String(config.nodeBin || process.env.GEMINI_CLI_NODE_BIN || process.execPath || "node").trim(),
      entrypoint: String(config.entrypoint || process.env.GEMINI_CLI_ENTRYPOINT || "").trim(),
      approvalMode: String(config.approvalMode || process.env.GEMINI_CLI_APPROVAL_MODE || "plan").trim(),
      outputFormat: String(config.outputFormat || process.env.GEMINI_CLI_OUTPUT_FORMAT || "json").trim(),
      extraArgs: config.extraArgs,
    });
  }

  return createMockVisionAdapter();
};

module.exports = {
  createVisionAdapter,
  resolveBaseUrl,
};
