const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { parseJsonFromText } = require("../models/schema");

const execFileAsync = promisify(execFile);

const AI_RESPONSE_LOG_ENABLED = String(process.env.AI_RESPONSE_LOG_ENABLED || "true")
  .trim()
  .toLowerCase() !== "false";
const AI_RESPONSE_LOG_MAX_CHARS = Math.max(
  120,
  Number.parseInt(String(process.env.AI_RESPONSE_LOG_MAX_CHARS || ""), 10) || 1800,
);
const GEMINI_CLI_OAUTH_ONLY = String(process.env.GEMINI_CLI_OAUTH_ONLY || "true")
  .trim()
  .toLowerCase() !== "false";

const buildLogPreview = (text, limit = 240) =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(20, Number(limit) || 240));

const logAiResponsePreview = (tag, value) => {
  if (!AI_RESPONSE_LOG_ENABLED) return;
  const preview = buildLogPreview(value, AI_RESPONSE_LOG_MAX_CHARS);
  console.info(`[ai:${tag}] response preview: ${preview}`);
};

const logAiInferenceTiming = ({ tag, model, status, elapsedMs, detail = "" }) => {
  const safeTag = String(tag || "gemini_cli");
  const safeModel = String(model || "unknown");
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

const buildGeminiEntrypointCandidates = ({ command, entrypoint }) => {
  const candidates = [];
  if (entrypoint) candidates.push(entrypoint);
  if (String(command || "").includes(path.sep)) {
    const derived = String(command).replace(
      new RegExp(`${path.sep}bin${path.sep}gemini$`),
      `${path.sep}lib${path.sep}node_modules${path.sep}@google${path.sep}gemini-cli${path.sep}bundle${path.sep}gemini.js`,
    );
    if (derived && derived !== command) candidates.push(derived);
  }
  candidates.push("/usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js");
  return Array.from(new Set(candidates.filter(Boolean)));
};

const resolveGeminiCliInvocation = async ({ command, cliArgs, nodeBin, entrypoint }) => {
  const candidates = buildGeminiEntrypointCandidates({ command, entrypoint });
  for (const entryPath of candidates) {
    try {
      await fs.access(entryPath);
      return {
        command: nodeBin,
        args: [entryPath, ...cliArgs],
        env: buildCliEnv(nodeBin),
        usingEntrypoint: true,
      };
    } catch (_error) {
      // no-op
    }
  }
  return {
    command,
    args: cliArgs,
    env: buildCliEnv(command),
    usingEntrypoint: false,
  };
};

const callGeminiCli = async ({
  command = "gemini",
  nodeBin = process.execPath || "node",
  entrypoint = "",
  model,
  prompt,
  timeoutMs = 180000,
  logTag = "gemini_cli",
  approvalMode = "plan",
  outputFormat = "json",
  extraArgs = [],
}) => {
  const startedAt = Date.now();
  const cliArgs = [
    ...extraArgs,
    "-m",
    model,
    "--approval-mode",
    approvalMode,
    "--output-format",
    outputFormat,
    "-p",
    prompt,
  ];
  const invocation = await resolveGeminiCliInvocation({
    command,
    cliArgs,
    nodeBin,
    entrypoint,
  });

  try {
    const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: invocation.env,
    });
    const rawOutput = String(stdout || "").trim();
    if (!rawOutput) {
      logAiInferenceTiming({
        tag: logTag,
        model,
        status: "empty_content",
        elapsedMs: Date.now() - startedAt,
        detail: buildLogPreview(stderr || "", 160),
      });
      throw new Error("gemini_cli_empty_response");
    }

    logAiResponsePreview(`${logTag}:raw`, rawOutput);

    let responseText = rawOutput;
    try {
      const payload = JSON.parse(rawOutput);
      if (typeof payload?.response === "string" && payload.response.trim()) {
        responseText = payload.response.trim();
      } else if (typeof payload?.result === "string" && payload.result.trim()) {
        responseText = payload.result.trim();
      }
    } catch (_error) {
      responseText = rawOutput;
    }

    logAiInferenceTiming({
      tag: logTag,
      model,
      status: "success",
      elapsedMs: Date.now() - startedAt,
      detail: invocation.usingEntrypoint ? "entrypoint_mode" : "",
    });
    return responseText;
  } catch (error) {
    const timeout = isExecTimeoutError(error);
    logAiInferenceTiming({
      tag: logTag,
      model,
      status: timeout ? "timeout" : "exception",
      elapsedMs: Date.now() - startedAt,
      detail: [
        timeout ? `timeout_${timeoutMs}ms` : "",
        buildLogPreview(error?.stderr || "", 120),
        error instanceof Error ? buildLogPreview(error.message, 120) : "",
      ]
        .filter(Boolean)
        .join(" | "),
    });
    throw error;
  }
};

const createGeminiCliAdapter = ({
  model = process.env.GEMINI_CLI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
  timeoutMs = Number.parseInt(String(process.env.GEMINI_CLI_REQUEST_TIMEOUT_MS || ""), 10) || 180000,
  pageTimeoutMs,
  summaryTimeoutMs,
  topicsTimeoutMs,
  command = process.env.GEMINI_CLI_BIN || "gemini",
  nodeBin = process.env.GEMINI_CLI_NODE_BIN || process.execPath || "node",
  entrypoint = process.env.GEMINI_CLI_ENTRYPOINT || "",
  approvalMode = process.env.GEMINI_CLI_APPROVAL_MODE || "plan",
  outputFormat = process.env.GEMINI_CLI_OUTPUT_FORMAT || "json",
  extraArgs = splitCliArgs(process.env.GEMINI_CLI_EXTRA_ARGS || ""),
  enableVision = String(process.env.GEMINI_CLI_ENABLE_VISION || "false").trim().toLowerCase() === "true",
}) => {
  const resolvedExtraArgs = Array.isArray(extraArgs) ? extraArgs : splitCliArgs(extraArgs);

  return {
  provider: "gemini_cli",
  model: String(model || "").trim(),
  async analyzePage({ imagePath, pageNumber, promptTemplate }) {
    if (!enableVision) {
      throw new Error("gemini_cli_vision_disabled");
    }

    const taskPrompt = [
      promptTemplate,
      `page_number=${pageNumber}`,
      `image_path=${imagePath}`,
      "Analyze the image file referenced by image_path and return JSON only.",
    ].join("\n\n");
    const rawContent = await callGeminiCli({
      command,
      model,
      prompt: taskPrompt,
      timeoutMs: pageTimeoutMs || timeoutMs,
      logTag: `vision_page_${pageNumber}`,
      nodeBin,
      entrypoint,
      approvalMode,
      outputFormat,
      extraArgs: resolvedExtraArgs,
    });
    const parsed = parseJsonFromText(rawContent);
    logAiResponsePreview(`vision_page_${pageNumber}:parsed`, JSON.stringify(parsed));
    return parsed;
  },
  async summarizeDocument({ pages, promptTemplate }) {
    const taskPrompt = `${promptTemplate}\n\n입력 페이지 분석 JSON:\n${JSON.stringify(pages)}`;
    const rawContent = await callGeminiCli({
      command,
      model,
      prompt: taskPrompt,
      timeoutMs: summaryTimeoutMs || timeoutMs,
      logTag: "document_summary",
      nodeBin,
      entrypoint,
      approvalMode,
      outputFormat,
      extraArgs: resolvedExtraArgs,
    });
    const parsed = parseJsonFromText(rawContent);
    logAiResponsePreview("document_summary:parsed", JSON.stringify(parsed));
    return parsed;
  },
  async generateTopics({ summary, promptTemplate }) {
    const taskPrompt = `${promptTemplate}\n\n입력 문서 요약 JSON:\n${JSON.stringify(summary)}`;
    const rawContent = await callGeminiCli({
      command,
      model,
      prompt: taskPrompt,
      timeoutMs: topicsTimeoutMs || timeoutMs,
      logTag: "discussion_topics",
      nodeBin,
      entrypoint,
      approvalMode,
      outputFormat,
      extraArgs: resolvedExtraArgs,
    });
    const parsed = parseJsonFromText(rawContent);
    logAiResponsePreview("discussion_topics:parsed", JSON.stringify(parsed));
    return parsed;
  },
  };
};

module.exports = {
  createGeminiCliAdapter,
};
