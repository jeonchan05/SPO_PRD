const fs = require("fs/promises");
const { parseJsonFromText } = require("../models/schema");

const AI_RESPONSE_LOG_ENABLED = String(process.env.AI_RESPONSE_LOG_ENABLED || "true")
  .trim()
  .toLowerCase() !== "false";
const AI_RESPONSE_LOG_MAX_CHARS = Math.max(
  120,
  Number.parseInt(String(process.env.AI_RESPONSE_LOG_MAX_CHARS || ""), 10) || 1800,
);

const toBase64DataUrl = async (imagePath) => {
  const file = await fs.readFile(imagePath);
  return `data:image/png;base64,${file.toString("base64")}`;
};

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
  const safeTag = String(tag || "openai_compatible");
  const safeModel = String(model || "unknown");
  const safeStatus = String(status || "unknown");
  const ms = Number.isFinite(Number(elapsedMs)) ? Math.max(0, Math.floor(Number(elapsedMs))) : 0;
  const suffix = detail ? ` detail=${detail}` : "";
  console.info(`[ai:${safeTag}] model=${safeModel} status=${safeStatus} elapsedMs=${ms}${suffix}`);
};

const parseContent = (payload) => {
  const messageContent = payload?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        return "";
      })
      .join("\n");
  }
  return "";
};

const callOpenAiCompatible = async ({ baseUrl, apiKey, model, messages, timeoutMs = 300000, logTag = "openai_compatible" }) => {
  if (!baseUrl) throw new Error("MODEL_BASE_URL이 설정되지 않았습니다.");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      logAiInferenceTiming({
        tag: logTag,
        model,
        status: "http_error",
        elapsedMs: Date.now() - startedAt,
        detail: `http_${response.status}`,
      });
      throw new Error(`모델 요청 실패(${response.status}): ${bodyText.slice(0, 300)}`);
    }

    const payload = await response.json();
    logAiInferenceTiming({
      tag: logTag,
      model,
      status: "success",
      elapsedMs: Date.now() - startedAt,
    });
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logAiInferenceTiming({
        tag: logTag,
        model,
        status: "timeout",
        elapsedMs: Date.now() - startedAt,
        detail: `timeout_${timeoutMs}ms`,
      });
      throw new Error(`model_request_timeout_${timeoutMs}ms`);
    }
    logAiInferenceTiming({
      tag: logTag,
      model,
      status: "exception",
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? buildLogPreview(error.message, 120) : "",
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildImageMessages = ({ systemPrompt, taskPrompt, imageDataUrl }) => [
  {
    role: "system",
    content: systemPrompt,
  },
  {
    role: "user",
    content: [
      { type: "text", text: taskPrompt },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ],
  },
];

const buildTextMessages = ({ systemPrompt, taskPrompt }) => [
  {
    role: "system",
    content: systemPrompt,
  },
  {
    role: "user",
    content: taskPrompt,
  },
];

const createOpenAiCompatibleAdapter = ({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  timeoutMs = 300000,
  pageTimeoutMs,
  summaryTimeoutMs,
  topicsTimeoutMs,
}) => ({
  provider: "openai_compatible",
  model,
  async analyzePage({ imagePath, pageNumber, promptTemplate }) {
    const imageDataUrl = await toBase64DataUrl(imagePath);
    const taskPrompt = `${promptTemplate}\n\npage_number=${pageNumber}`;

    const payload = await callOpenAiCompatible({
      baseUrl,
      apiKey,
      model,
      messages: buildImageMessages({
        systemPrompt,
        taskPrompt,
        imageDataUrl,
      }),
      timeoutMs: pageTimeoutMs || timeoutMs,
      logTag: `vision_page_${pageNumber}`,
    });
    const rawContent = parseContent(payload);
    logAiResponsePreview(`vision_page_${pageNumber}:raw`, rawContent);
    const parsed = parseJsonFromText(rawContent);
    logAiResponsePreview(`vision_page_${pageNumber}:parsed`, JSON.stringify(parsed));
    return parsed;
  },
  async summarizeDocument({ pages, promptTemplate }) {
    const taskPrompt = `${promptTemplate}\n\n입력 페이지 분석 JSON:\n${JSON.stringify(pages)}`;
    const payload = await callOpenAiCompatible({
      baseUrl,
      apiKey,
      model,
      messages: buildTextMessages({
        systemPrompt,
        taskPrompt,
      }),
      timeoutMs: summaryTimeoutMs || timeoutMs,
      logTag: "document_summary",
    });
    const rawContent = parseContent(payload);
    logAiResponsePreview("document_summary:raw", rawContent);
    const parsed = parseJsonFromText(rawContent);
    logAiResponsePreview("document_summary:parsed", JSON.stringify(parsed));
    return parsed;
  },
  async generateTopics({ summary, promptTemplate }) {
    const taskPrompt = `${promptTemplate}\n\n입력 문서 요약 JSON:\n${JSON.stringify(summary)}`;
    const payload = await callOpenAiCompatible({
      baseUrl,
      apiKey,
      model,
      messages: buildTextMessages({
        systemPrompt,
        taskPrompt,
      }),
      timeoutMs: topicsTimeoutMs || timeoutMs,
      logTag: "discussion_topics",
    });
    const rawContent = parseContent(payload);
    logAiResponsePreview("discussion_topics:raw", rawContent);
    const parsed = parseJsonFromText(rawContent);
    logAiResponsePreview("discussion_topics:parsed", JSON.stringify(parsed));
    return parsed;
  },
});

module.exports = {
  createOpenAiCompatibleAdapter,
  callOpenAiCompatible,
};
