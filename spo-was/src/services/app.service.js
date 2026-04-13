const { randomUUID } = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { pool } = require("../config/db");
const {
  defaultProfileImageUrl,
  minioPublicBaseUrl,
  minioEndpoint,
  minioPort,
  minioUseSSL,
  minioBucket,
} = require("../config/minio");
const {
  normalizeString,
  normalizeNullableString,
  toPositiveInt,
  toNumberOrDefault,
  parseDateTime,
} = require("../modules/common/value.utils");
const { mapAppUser } = require("../modules/common/user.mapper");
const { fetchUserById } = require("../modules/common/user.repository");
const {
  mapStudyGroup,
  mapStudySession,
  mapAttendance,
  mapStudyRecruitment,
  mapStudyRecruitmentApplication,
} = require("../modules/app/app.mappers");
const { APP_QUERIES, buildListAttendanceQuery } = require("../modules/app/app.queries");
const { uploadProfileImage, removeProfileImage } = require("../modules/auth/profile-image.storage");
const { validateEmail, validateName, validatePassword } = require("../modules/auth/auth.validation");
const { getTenantPool, buildTenantDatabaseName } = require("../modules/common/tenant-db");
const { hashPassword, verifyPassword } = require("../utils/password");
const { parseJsonFromText } = require("../pipeline/models/schema");
const { createUserNotification } = require("./notification.service");

const execFileAsync = promisify(execFile);

const SESSION_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"];
const ATTENDANCE_STATUSES = ["present", "late", "absent"];
const RECRUITMENT_STATUSES = ["open", "matching", "completed", "closed"];
const RECRUITMENT_PARTICIPATION_INTENTS = ["join", "skip"];
const RECRUITMENT_PRESENTATION_LEVELS = ["passive", "normal", "presenter"];
const SCHEDULE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OPERATOR_ROLES = new Set(["operator", "admin", "mentor", "academy"]);
const DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG = {
  participationTitle: "스터디 참여 의사",
  participationOptions: [
    { key: "join", label: "참여할래요" },
    { key: "skip", label: "이번엔 어려워요" },
  ],
  enableMbti: false,
  mbtiTitle: "MBTI",
  enablePreferredStyle: false,
  styleTitle: "같이 하고 싶은 스타일",
  styleOptions: [
    "조용히 집중해서 함께 공부",
    "개념을 차근차근 정리하며 공부",
    "질문을 많이 주고받는 토론형",
    "문제 풀이를 함께 점검하는 피드백형",
  ],
  enablePersonality: false,
  presentationTitle: "성격",
  presentationOptions: [
    { key: "passive", label: "소극적" },
    { key: "normal", label: "보통" },
    { key: "presenter", label: "활발" },
  ],
  customChecks: [],
};
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
  Number.parseInt(String(process.env.GEMINI_CLI_REQUEST_TIMEOUT_MS || ""), 10) || 120000,
);

const getCurrentUserId = (req) => toPositiveInt(req.auth?.userId);

const requireCurrentUser = async (req, connection = pool) => {
  const userId = getCurrentUserId(req);

  if (!userId) {
    return {
      error: {
        status: 401,
        body: { message: "로그인이 필요합니다." },
      },
    };
  }

  const user = await fetchUserById(connection, userId);
  if (!user) {
    return {
      error: {
        status: 404,
        body: { message: "사용자 정보를 찾을 수 없습니다." },
      },
    };
  }

  if (user.status !== "active") {
    return {
      error: {
        status: 403,
        body: { message: "비활성화된 계정입니다. 관리자에게 문의해주세요." },
      },
    };
  }

  return { user };
};

const mapFriend = (friend) => ({
  id: friend.id,
  name: friend.name,
  loginId: friend.login_id,
  email: friend.email,
  profileImageUrl: friend.profile_image_url || null,
  role: friend.role,
  status: friend.user_status,
  createdAt: friend.created_at,
});

const mapPersonalSchedule = (schedule) => ({
  id: Number(schedule.id),
  date: normalizeString(schedule.schedule_date),
  time: normalizeString(schedule.schedule_time).slice(0, 5),
  title: schedule.title,
  note: schedule.note || "",
  createdAt: schedule.created_at,
  updatedAt: schedule.updated_at,
});

const normalizeScheduleDateText = (value) => {
  const normalized = normalizeString(value);
  if (!SCHEDULE_DATE_PATTERN.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === normalized ? normalized : null;
};

const normalizeScheduleTimeText = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return "09:00";

  const matched = normalized.match(SCHEDULE_TIME_PATTERN);
  if (!matched) return null;
  return `${matched[1]}:${matched[2]}`;
};

const mapFriendRequest = (request) => ({
  id: request.id,
  requesterUserId: request.requester_user_id,
  addresseeUserId: request.addressee_user_id,
  status: request.friendship_status,
  requestedAt: request.requested_at,
  respondedAt: request.responded_at,
  requester:
    request.requester_id != null
      ? {
          id: request.requester_id,
          loginId: request.requester_login_id,
          email: request.requester_email,
          name: request.requester_name,
          profileImageUrl: request.requester_profile_image_url || null,
          role: request.requester_role,
          status: request.requester_account_status,
          createdAt: request.requester_created_at,
        }
      : undefined,
  addressee:
    request.addressee_id != null
      ? {
          id: request.addressee_id,
          loginId: request.addressee_login_id,
          email: request.addressee_email,
          name: request.addressee_name,
          profileImageUrl: request.addressee_profile_image_url || null,
          role: request.addressee_role,
          status: request.addressee_account_status,
          createdAt: request.addressee_created_at,
        }
      : undefined,
});

const mapAcademy = (academy) => ({
  id: academy.id,
  name: academy.name,
  address: academy.address || null,
  businessRegistrationNumber: academy.business_registration_number || null,
  registeredAt: academy.registered_at || null,
});

const normalizeVerificationCode = (value) =>
  normalizeString(value)
    .replace(/[\s-]/g, "")
    .toUpperCase();

const normalizeRecruitmentStatus = (value) =>
  RECRUITMENT_STATUSES.includes(value) ? value : null;

const normalizeParticipationIntent = (value) =>
  RECRUITMENT_PARTICIPATION_INTENTS.includes(value) ? value : "join";

const normalizePresentationLevel = (value) =>
  RECRUITMENT_PRESENTATION_LEVELS.includes(value) ? value : "normal";

const isOperatorUser = (user) => OPERATOR_ROLES.has(normalizeString(user?.role));

const parseJsonArrayText = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  const normalized = normalizeString(value);
  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeString(item))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const stringifyJsonArray = (value, maxCount = 12, maxItemLength = 80) => {
  if (!Array.isArray(value)) return "[]";
  const normalized = value
    .map((item) => normalizeString(item).slice(0, maxItemLength))
    .filter(Boolean)
    .slice(0, maxCount);
  return JSON.stringify(normalized);
};

const parseJsonObjectText = (value) => {
  if (!value) return {};
  let parsed = value;
  if (typeof parsed === "string") {
    const normalized = normalizeString(parsed);
    if (!normalized) return {};
    try {
      parsed = JSON.parse(normalized);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.entries(parsed).reduce((acc, [rawKey, rawValue]) => {
    const key = normalizeString(rawKey).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
    const valueText = normalizeString(rawValue).slice(0, 120);
    if (!key || !valueText) return acc;
    acc[key] = valueText;
    return acc;
  }, {});
};

const stringifyJsonObject = (value, maxEntries = 20, maxValueLength = 120) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "{}";
  const normalized = Object.entries(value).reduce((acc, [rawKey, rawValue]) => {
    if (Object.keys(acc).length >= maxEntries) return acc;
    const key = normalizeString(rawKey).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
    const valueText = normalizeString(rawValue).slice(0, maxValueLength);
    if (!key || !valueText) return acc;
    acc[key] = valueText;
    return acc;
  }, {});
  return JSON.stringify(normalized);
};

const buildDefaultRecruitmentApplicationCheckConfig = () => ({
  participationTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationTitle,
  participationOptions: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.participationOptions.map((item) => ({
    key: item.key,
    label: item.label,
  })),
  enableMbti: Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enableMbti),
  mbtiTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.mbtiTitle,
  enablePreferredStyle: Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePreferredStyle),
  styleTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleTitle,
  styleOptions: [...DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.styleOptions],
  enablePersonality: Boolean(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.enablePersonality),
  presentationTitle: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationTitle,
  presentationOptions: DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.presentationOptions.map((item) => ({
    key: item.key,
    label: item.label,
  })),
  customChecks: Array.isArray(DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.customChecks)
    ? DEFAULT_RECRUITMENT_APPLICATION_CHECK_CONFIG.customChecks.map((item, index) => ({
        id: normalizeString(item?.id)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "")
          .slice(0, 60) || `custom_${index + 1}`,
        title: normalizeString(item?.title).slice(0, 80),
        inputType: (() => {
          const normalizedInputType = normalizeString(item?.inputType).toLowerCase();
          if (normalizedInputType === "radio") return "radio";
          if (normalizedInputType === "select") return "select";
          return "button";
        })(),
        options: Array.from(
          new Set(
            (Array.isArray(item?.options) ? item.options : [])
              .map((option) => normalizeString(option).slice(0, 80))
              .filter(Boolean),
          ),
        ).slice(0, 8),
        enabled: typeof item?.enabled === "boolean" ? item.enabled : true,
      })).filter((item) => item.title && item.options.length >= 2)
    : [],
});

const getLabeledOptionByKey = (sourceOptions, key, fallbackLabel) => {
  if (!Array.isArray(sourceOptions)) return fallbackLabel;
  const matched = sourceOptions.find((option) => normalizeString(option?.key) === key);
  const normalizedLabel = normalizeString(matched?.label).slice(0, 80);
  return normalizedLabel || fallbackLabel;
};

const normalizeBooleanValue = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return fallback;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeRecruitmentApplicationCheckConfig = (value) => {
  const fallback = buildDefaultRecruitmentApplicationCheckConfig();

  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback;
  }

  const participationTitle =
    normalizeString(parsed.participationTitle).slice(0, 80) || fallback.participationTitle;
  const mbtiTitle = normalizeString(parsed.mbtiTitle).slice(0, 40) || fallback.mbtiTitle;
  const styleTitle = normalizeString(parsed.styleTitle).slice(0, 80) || fallback.styleTitle;
  const presentationTitle =
    normalizeString(parsed.presentationTitle).slice(0, 80) || fallback.presentationTitle;
  const enableMbti = normalizeBooleanValue(parsed.enableMbti, fallback.enableMbti);
  const enablePreferredStyle = normalizeBooleanValue(
    parsed.enablePreferredStyle,
    fallback.enablePreferredStyle,
  );
  const enablePersonality = normalizeBooleanValue(parsed.enablePersonality, fallback.enablePersonality);

  const participationOptions = [
    {
      key: "join",
      label: getLabeledOptionByKey(parsed.participationOptions, "join", fallback.participationOptions[0].label),
    },
    {
      key: "skip",
      label: getLabeledOptionByKey(parsed.participationOptions, "skip", fallback.participationOptions[1].label),
    },
  ];

  const presentationOptions = [
    {
      key: "passive",
      label: getLabeledOptionByKey(parsed.presentationOptions, "passive", fallback.presentationOptions[0].label),
    },
    {
      key: "normal",
      label: getLabeledOptionByKey(parsed.presentationOptions, "normal", fallback.presentationOptions[1].label),
    },
    {
      key: "presenter",
      label: getLabeledOptionByKey(parsed.presentationOptions, "presenter", fallback.presentationOptions[2].label),
    },
  ];

  const styleOptions = Array.from(
    new Set(
      (Array.isArray(parsed.styleOptions) ? parsed.styleOptions : [])
        .map((option) => normalizeString(option).slice(0, 80))
        .filter(Boolean),
    ),
  ).slice(0, 8);
  const customChecks = (Array.isArray(parsed.customChecks) ? parsed.customChecks : [])
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const id = normalizeString(item.id)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 60) || `custom_${index + 1}`;
      const title = normalizeString(item.title).slice(0, 80);
      const inputType = (() => {
        const normalizedInputType = normalizeString(item.inputType).toLowerCase();
        if (normalizedInputType === "radio") return "radio";
        if (normalizedInputType === "select") return "select";
        return "button";
      })();
      const enabled = normalizeBooleanValue(item.enabled, true);
      const options = Array.from(
        new Set(
          (Array.isArray(item.options) ? item.options : [])
            .map((option) => normalizeString(option).slice(0, 80))
            .filter(Boolean),
        ),
      ).slice(0, 8);
      if (!title || options.length < 2) return null;
      return {
        id,
        title,
        inputType,
        options,
        enabled,
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  return {
    participationTitle,
    participationOptions,
    enableMbti,
    mbtiTitle,
    enablePreferredStyle,
    styleTitle,
    styleOptions: styleOptions.length > 0 ? styleOptions : fallback.styleOptions,
    enablePersonality,
    presentationTitle,
    presentationOptions,
    customChecks,
  };
};

const stringifyRecruitmentApplicationCheckConfig = (value) =>
  JSON.stringify(normalizeRecruitmentApplicationCheckConfig(value));

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

const buildGeminiCliEnv = (command) => {
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
        env: buildGeminiCliEnv(GEMINI_CLI_NODE_BIN),
      };
    } catch (_error) {
      // no-op
    }
  }

  return {
    command: GEMINI_CLI_BIN,
    args: cliArgs,
    env: buildGeminiCliEnv(GEMINI_CLI_BIN),
  };
};

const buildGeminiCliAuthWarning = () =>
  [
    "AI 매칭 엔진 인증이 필요합니다. OAuth 로그인을 먼저 진행해주세요.",
    "예시: docker exec -it spo-was /usr/local/bin/node /usr/local/lib/node_modules/@google/gemini-cli/bundle/gemini.js",
  ].join(" ");

const callGeminiCliJson = async (userPrompt, fallbackValue, options = {}) => {
  const timeoutMs = Math.max(
    5000,
    Number.parseInt(String(options.timeoutMs || ""), 10) || GEMINI_CLI_REQUEST_TIMEOUT_MS,
  );
  const model = String(options.model || GEMINI_CLI_MODEL || "gemini-2.5-flash").trim();
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
    const { stdout } = await execFileAsync(invocation.command, invocation.args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: invocation.env,
    });
    const rawOutput = String(stdout || "").trim();
    if (!rawOutput) {
      return {
        value: fallbackValue,
        generatedBy: "fallback",
        warning: "AI 매칭 엔진 응답이 비어 있습니다.",
      };
    }

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

    return {
      value: parsedValue,
      generatedBy: `gemini_cli:${model}`,
      warning: null,
    };
  } catch (error) {
    const timeout = isExecTimeoutError(error);
    const errorBlob = `${error?.stdout || ""}\n${error?.stderr || ""}\n${error instanceof Error ? error.message : ""}`;
    const requiresAuth = /Please set an Auth method/i.test(errorBlob);
    return {
      value: fallbackValue,
      generatedBy: "fallback",
      warning: requiresAuth
        ? buildGeminiCliAuthWarning()
        : timeout
          ? `AI 매칭 엔진 요청 타임아웃(${timeoutMs}ms)`
          : "AI 매칭 엔진 호출 중 오류가 발생했습니다.",
    };
  }
};

const toRecruitmentResponse = (row) => {
  const mapped = mapStudyRecruitment(row);
  return {
    ...mapped,
    aiTopicExamples: parseJsonArrayText(mapped.aiTopicExamples),
    applicationCheckConfig: normalizeRecruitmentApplicationCheckConfig(mapped.applicationCheckConfig),
  };
};

const toRecruitmentApplicationResponse = (row) => {
  const mapped = mapStudyRecruitmentApplication(row);
  return {
    ...mapped,
    availableTimeSlots: parseJsonArrayText(mapped.availableTimeSlots),
    customResponses: parseJsonObjectText(mapped.customResponses),
  };
};

const toRecruitmentApplicantResponse = (
  row,
  teamAssignmentByUserId = new Map(),
  waitlistOrderByUserId = new Map(),
) => {
  const application = toRecruitmentApplicationResponse(row);
  const userId = Number(application.userId || row.user_id || 0);
  const assigned = teamAssignmentByUserId.get(userId) || null;
  const waitlistOrder = waitlistOrderByUserId.get(userId);

  return {
    ...application,
    userName: normalizeString(row.user_name),
    loginId: normalizeString(row.login_id) || null,
    matchedTeamNumber: assigned?.teamNumber != null ? Number(assigned.teamNumber) : null,
    matchedRole: assigned?.role || null,
    waitlistOrder: waitlistOrder != null ? Number(waitlistOrder) : null,
  };
};

const toUserAcademyIds = (academies) => {
  if (!Array.isArray(academies)) return [];
  const ids = academies
    .map((academy) => toPositiveInt(academy?.id))
    .filter((academyId) => Number.isInteger(academyId) && academyId > 0);
  return Array.from(new Set(ids));
};

const isRecruitmentVisibleToAcademySet = (recruitment, academyIdSet) => {
  const academyId = toPositiveInt(recruitment?.academyId ?? recruitment?.academy_id);
  if (!academyId || !(academyIdSet instanceof Set)) return false;
  return academyIdSet.has(academyId);
};

const FORBIDDEN_RECRUITMENT_ACCESS_ERROR = {
  status: 403,
  body: { message: "등록한 학원에서 올라온 모집 공고만 확인할 수 있습니다." },
};

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const toDateKeyInKst = (value) => {
  const parsed = parseDateTime(value);
  if (!parsed) return "";
  return KST_DATE_FORMATTER.format(parsed);
};

const isPastDateInKst = (value) => {
  const targetDateKey = toDateKeyInKst(value);
  if (!targetDateKey) return false;
  const todayDateKey = toDateKeyInKst(new Date());
  if (!todayDateKey) return false;
  return targetDateKey < todayDateKey;
};

const hasPersistedStudyContent = (topicDescription) => {
  const normalizedDescription = normalizeString(topicDescription);
  if (!normalizedDescription) return false;

  try {
    const parsed = JSON.parse(normalizedDescription);
    if (!parsed || typeof parsed !== "object") {
      return true;
    }

    const answerDraft = normalizeString(parsed.answerDraft);
    const confirmedTopic = normalizeString(parsed.confirmedTopic);
    const ocrExtractedText = normalizeString(parsed.ocrExtractedText);
    const aiReviewedAt = normalizeString(parsed.aiReviewedAt);
    const hasAiReview = parsed.aiReview && typeof parsed.aiReview === "object";

    return Boolean(answerDraft || confirmedTopic || ocrExtractedText || aiReviewedAt || hasAiReview);
  } catch {
    return true;
  }
};

const hashStringToUint32 = (value) => {
  let hash = 2166136261;
  const text = normalizeString(value);

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seedText) => {
  let state = hashStringToUint32(seedText) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const shuffleWithSeed = (rows, seedText) => {
  const list = [...rows];
  const random = createSeededRandom(seedText);

  for (let i = list.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(random() * (i + 1));
    [list[i], list[randomIndex]] = [list[randomIndex], list[i]];
  }

  return list;
};

const SLOT_LABEL_BY_KEY = {
  mon_19: "월요일 19:00",
  mon_20: "월요일 20:00",
  tue_19: "화요일 19:00",
  tue_20: "화요일 20:00",
  wed_19: "수요일 19:00",
  wed_20: "수요일 20:00",
  thu_19: "목요일 19:00",
  thu_20: "목요일 20:00",
  fri_19: "금요일 19:00",
  fri_20: "금요일 20:00",
  sat_10: "토요일 10:00",
  sat_14: "토요일 14:00",
  sun_10: "일요일 10:00",
  sun_14: "일요일 14:00",
};

const selectFirstMeetingLabel = (teamApplications) => {
  const slotCountMap = new Map();

  teamApplications.forEach((application) => {
    const slots = parseJsonArrayText(application.available_time_slots);
    slots.forEach((slot) => {
      slotCountMap.set(slot, (slotCountMap.get(slot) || 0) + 1);
    });
  });

  if (slotCountMap.size === 0) {
    return null;
  }

  const ordered = Array.from(slotCountMap.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], "ko");
  });

  const bestSlotKey = ordered[0][0];
  return SLOT_LABEL_BY_KEY[bestSlotKey] || bestSlotKey;
};

const compareApplicantOrder = (a, b) => {
  const aTime = parseDateTime(a?.updated_at || a?.created_at || null)?.getTime() || 0;
  const bTime = parseDateTime(b?.updated_at || b?.created_at || null)?.getTime() || 0;
  if (aTime !== bTime) return aTime - bTime;
  return Number(a?.id || 0) - Number(b?.id || 0);
};

const scoreApplicantSimilarity = (left, right) => {
  const leftStyle = normalizeString(left?.preferred_style).toLowerCase();
  const rightStyle = normalizeString(right?.preferred_style).toLowerCase();
  const leftMbti = normalizeString(left?.mbti_type).toUpperCase();
  const rightMbti = normalizeString(right?.mbti_type).toUpperCase();
  const leftPresentation = normalizeString(left?.presentation_level);
  const rightPresentation = normalizeString(right?.presentation_level);
  const leftCustom = parseJsonObjectText(left?.custom_responses);
  const rightCustom = parseJsonObjectText(right?.custom_responses);

  let score = 0;
  if (leftStyle && rightStyle && leftStyle === rightStyle) {
    score += 4;
  }
  if (leftMbti.length === 4 && rightMbti.length === 4) {
    for (let index = 0; index < 4; index += 1) {
      if (leftMbti[index] === rightMbti[index]) score += 1;
    }
  }
  if (leftPresentation && rightPresentation && leftPresentation === rightPresentation) {
    score += 2;
  }

  const customKeys = new Set([...Object.keys(leftCustom), ...Object.keys(rightCustom)]);
  customKeys.forEach((key) => {
    if (leftCustom[key] && rightCustom[key] && leftCustom[key] === rightCustom[key]) {
      score += 1;
    }
  });

  return score;
};

const buildAiMatchingPlan = (applicantRows, teamSize) => {
  const normalizedTeamSize = Math.max(2, Math.min(8, Number(teamSize || 4)));
  const remaining = [...applicantRows].sort(compareApplicantOrder);
  const teams = [];

  while (remaining.length >= 2) {
    const seedApplicant = remaining.shift();
    if (!seedApplicant) break;

    let targetTeamSize = Math.min(normalizedTeamSize, remaining.length + 1);
    if (remaining.length + 1 - targetTeamSize === 1) {
      targetTeamSize = Math.max(2, targetTeamSize - 1);
    }

    const nextTeamMembers = [seedApplicant];
    while (nextTeamMembers.length < targetTeamSize && remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestApplicant = remaining[0];

      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const similarityScore = nextTeamMembers.reduce(
          (sum, teammate) => sum + scoreApplicantSimilarity(candidate, teammate),
          0,
        );

        if (
          similarityScore > bestScore ||
          (similarityScore === bestScore && compareApplicantOrder(candidate, bestApplicant) < 0)
        ) {
          bestScore = similarityScore;
          bestIndex = index;
          bestApplicant = candidate;
        }
      }

      nextTeamMembers.push(remaining.splice(bestIndex, 1)[0]);
    }

    teams.push({
      teamNumber: teams.length + 1,
      members: nextTeamMembers,
    });
  }

  return {
    teams,
    waitlist: remaining,
  };
};

const normalizeMatchingTeamNameMap = (rawTeamNames) => {
  const teamNameByTeamNumber = new Map();
  if (!Array.isArray(rawTeamNames)) return teamNameByTeamNumber;

  rawTeamNames.forEach((rawTeamName) => {
    const teamNumber = toPositiveInt(rawTeamName?.teamNumber);
    const teamName = normalizeNullableString(rawTeamName?.teamName)?.slice(0, 80) || null;
    if (!teamNumber || !teamName) return;
    teamNameByTeamNumber.set(teamNumber, teamName);
  });

  return teamNameByTeamNumber;
};

const buildRecruitmentDefaultTeamName = (recruitment, teamNumber) => {
  const normalizedTeamNumber = toPositiveInt(teamNumber) || 1;
  const baseName =
    normalizeNullableString(recruitment?.targetClass)?.slice(0, 52) ||
    normalizeNullableString(recruitment?.title)?.slice(0, 52) ||
    "스터디";
  return `${baseName} ${normalizedTeamNumber}팀`;
};

const buildManualMatchingPlan = (applicantRows, rawAssignments, teamSize, teamNameByTeamNumber = new Map()) => {
  if (!Array.isArray(rawAssignments) || rawAssignments.length === 0) {
    return { error: { status: 400, body: { message: "최소 1명 이상 팀에 배정해주세요." } } };
  }

  const normalizedTeamSize = Math.max(2, Math.min(8, Number(teamSize || 4)));
  const applicantByApplicationId = new Map(
    applicantRows.map((row) => [Number(row.id), row]),
  );
  const assignmentByApplicationId = new Map();

  for (const rawAssignment of rawAssignments) {
    const applicationId = toPositiveInt(rawAssignment?.applicationId);
    const teamNumber = toPositiveInt(rawAssignment?.teamNumber);

    if (!applicationId || !teamNumber) {
      return { error: { status: 400, body: { message: "수동 매칭 항목 형식이 올바르지 않습니다." } } };
    }
    if (!applicantByApplicationId.has(applicationId)) {
      return { error: { status: 400, body: { message: "현재 신청자에 없는 항목이 포함되어 있습니다." } } };
    }
    if (assignmentByApplicationId.has(applicationId)) {
      return { error: { status: 400, body: { message: "동일 신청자를 중복 배정할 수 없습니다." } } };
    }

    assignmentByApplicationId.set(applicationId, teamNumber);
  }

  const teamBuckets = new Map();
  assignmentByApplicationId.forEach((teamNumber, applicationId) => {
    if (!teamBuckets.has(teamNumber)) {
      teamBuckets.set(teamNumber, []);
    }
    teamBuckets.get(teamNumber).push(applicantByApplicationId.get(applicationId));
  });

  const teams = Array.from(teamBuckets.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([teamNumber, members]) => {
      const filteredMembers = members.filter(Boolean);
      if (filteredMembers.length > normalizedTeamSize) {
        return {
          error: {
            status: 400,
            body: { message: `${teamNumber}팀 인원이 팀당 최대 인원(${normalizedTeamSize}명)을 초과했습니다.` },
          },
        };
      }
      if (filteredMembers.length < 2) {
        return {
          error: {
            status: 400,
            body: { message: `${teamNumber}팀은 최소 2명 이상 배정해야 합니다.` },
          },
        };
      }
      return {
        teamNumber: Number(teamNumber),
        teamName: normalizeNullableString(teamNameByTeamNumber.get(Number(teamNumber)))?.slice(0, 80) || null,
        members: filteredMembers,
      };
    });

  const teamError = teams.find((team) => team?.error)?.error;
  if (teamError) return { error: teamError };

  if (teams.length === 0) {
    return { error: { status: 400, body: { message: "팀 배정 데이터를 확인해주세요." } } };
  }

  const assignedApplicationIdSet = new Set(assignmentByApplicationId.keys());
  const waitlist = applicantRows.filter((row) => !assignedApplicationIdSet.has(Number(row.id)));

  return {
    teams,
    waitlist,
  };
};

const toMatchingAssignments = (teams) => {
  if (!Array.isArray(teams) || teams.length === 0) return [];

  return teams.flatMap((team) => {
    const teamNumber = toPositiveInt(team?.teamNumber);
    if (!teamNumber) return [];
    const members = Array.isArray(team?.members) ? team.members : [];
    return members
      .map((member) => ({
        applicationId: toPositiveInt(member?.id),
        teamNumber,
      }))
      .filter((item) => item.applicationId);
  });
};

const PRESENTATION_LEVEL_LABEL_BY_KEY = {
  passive: "소극적",
  normal: "보통",
  presenter: "활발",
};

const buildAiMatchingPromptPayload = ({ recruitment, applicantRows, teamSize }) => {
  const normalizedTeamSize = Math.max(2, Math.min(8, Number(teamSize || 4)));
  const normalizedConfig = normalizeRecruitmentApplicationCheckConfig(recruitment?.applicationCheckConfig);
  const enabledCustomChecks = (Array.isArray(normalizedConfig.customChecks) ? normalizedConfig.customChecks : [])
    .filter((check) => check?.enabled !== false)
    .slice(0, 12);
  const customCheckTitleById = new Map(
    enabledCustomChecks.map((check) => [normalizeString(check.id), normalizeString(check.title)]).filter(([id, title]) => id && title),
  );
  const applicants = (Array.isArray(applicantRows) ? applicantRows : []).map((row) => {
    const customResponses = parseJsonObjectText(row?.custom_responses);
    const labeledCustomResponses = Object.entries(customResponses).reduce((acc, [key, value]) => {
      const normalizedKey = normalizeString(key);
      const normalizedValue = normalizeString(value);
      if (!normalizedKey || !normalizedValue) return acc;
      const title = customCheckTitleById.get(normalizedKey);
      if (!title) return acc;
      acc[title] = normalizedValue;
      return acc;
    }, {});

    return {
      applicationId: toPositiveInt(row?.id),
      userId: toPositiveInt(row?.user_id),
      name: normalizeString(row?.user_name) || null,
      mbti: normalizedConfig.enableMbti ? normalizeString(row?.mbti_type).toUpperCase() || null : null,
      preferredStyle: normalizedConfig.enablePreferredStyle ? normalizeString(row?.preferred_style) || null : null,
      personality: normalizedConfig.enablePersonality
        ? PRESENTATION_LEVEL_LABEL_BY_KEY[normalizeString(row?.presentation_level)] || null
        : null,
      customResponses: labeledCustomResponses,
    };
  });

  const totalApplicants = applicants.length;
  const recommendedTeamCount = totalApplicants > 0 ? Math.ceil(totalApplicants / normalizedTeamSize) : 0;
  const maxPossibleTeamCount = totalApplicants > 0 ? Math.floor(totalApplicants / 2) : 0;

  return {
    recruitmentId: toPositiveInt(recruitment?.id),
    recruitmentTitle: normalizeString(recruitment?.title),
    targetClass: normalizeString(recruitment?.targetClass),
    teamSize: normalizedTeamSize,
    totalApplicants,
    expectedTeamCount: recommendedTeamCount,
    teamCountGuide: {
      recommendedTeamCount,
      maxPossibleTeamCount,
    },
    matchingCriteria: {
      mbti: Boolean(normalizedConfig.enableMbti),
      preferredStyle: Boolean(normalizedConfig.enablePreferredStyle),
      personality: Boolean(normalizedConfig.enablePersonality),
      customChecks: enabledCustomChecks.map((check) => normalizeString(check.title)).filter(Boolean),
    },
    applicants,
  };
};

const buildGeminiMatchingPrompt = (payload) =>
  [
    "너는 학원 스터디 매칭 운영 도우미야.",
    "아래 모집/신청자 정보를 기반으로 팀 배정안을 만들어.",
    "출력은 반드시 JSON 객체 하나만 반환해.",
    "",
    "배정 규칙:",
    "1) 한 명은 최대 한 팀에만 배정한다.",
    "2) teamNumber는 1부터 시작하는 연속 정수여야 한다.",
    "3) 한 팀은 최소 2명, 최대 teamSize명으로 구성한다.",
    "4) 가능한 한 많은 신청자를 팀에 배정하고, 남는 인원은 waitlistApplicationIds로 보낸다.",
    "5) matchingCriteria에서 true인 항목만 우선 고려해서 유사한 지원자끼리 배정한다.",
    "6) 팀 수는 teamCountGuide.recommendedTeamCount를 우선 목표로 하되, 규칙 3~5를 지키는 선에서 조정한다.",
    "7) 팀 수는 teamCountGuide.maxPossibleTeamCount를 초과하지 않는다.",
    "",
    "응답 JSON 스키마:",
    '{"teamAssignments":[{"applicationId":number,"teamNumber":number}],"waitlistApplicationIds":[number],"reason":"string"}',
    "",
    "입력 데이터(JSON):",
    JSON.stringify(payload),
  ].join("\n");

const normalizeGeminiTeamAssignments = (modelValue, applicantRows, teamSize) => {
  const normalizedTeamSize = Math.max(2, Math.min(8, Number(teamSize || 4)));
  const applicantIdList = (Array.isArray(applicantRows) ? applicantRows : [])
    .map((row) => toPositiveInt(row?.id))
    .filter(Boolean);
  const applicantIdSet = new Set(applicantIdList);

  const rawAssignments = Array.isArray(modelValue?.teamAssignments)
    ? modelValue.teamAssignments
    : Array.isArray(modelValue?.assignments)
      ? modelValue.assignments
      : [];
  const rawWaitlist = Array.isArray(modelValue?.waitlistApplicationIds)
    ? modelValue.waitlistApplicationIds
    : Array.isArray(modelValue?.waitlist)
      ? modelValue.waitlist
      : [];

  const groupedByTeamNumber = new Map();
  const assignedApplicationIdSet = new Set();

  rawAssignments.forEach((assignment) => {
    const applicationId = toPositiveInt(assignment?.applicationId || assignment?.applicantId || assignment?.id);
    const teamNumber = toPositiveInt(assignment?.teamNumber || assignment?.team || assignment?.groupNumber);
    if (!applicationId || !teamNumber) return;
    if (!applicantIdSet.has(applicationId)) return;
    if (assignedApplicationIdSet.has(applicationId)) return;

    if (!groupedByTeamNumber.has(teamNumber)) groupedByTeamNumber.set(teamNumber, []);
    groupedByTeamNumber.get(teamNumber).push(applicationId);
    assignedApplicationIdSet.add(applicationId);
  });

  const waitlistSet = new Set(
    rawWaitlist
      .map((value) => toPositiveInt(value))
      .filter((applicationId) => applicationId && applicantIdSet.has(applicationId)),
  );

  const normalizedAssignments = [];
  let normalizedTeamNumber = 1;
  Array.from(groupedByTeamNumber.entries())
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .forEach(([, applicationIds]) => {
      const dedupedIds = Array.from(new Set(applicationIds));
      for (let index = 0; index < dedupedIds.length; index += normalizedTeamSize) {
        const chunk = dedupedIds.slice(index, index + normalizedTeamSize);
        if (chunk.length < 2) {
          chunk.forEach((applicationId) => waitlistSet.add(applicationId));
          continue;
        }
        chunk.forEach((applicationId) => {
          normalizedAssignments.push({
            applicationId,
            teamNumber: normalizedTeamNumber,
          });
        });
        normalizedTeamNumber += 1;
      }
    });

  const finalAssignedSet = new Set(normalizedAssignments.map((item) => item.applicationId));
  applicantIdList.forEach((applicationId) => {
    if (!finalAssignedSet.has(applicationId)) {
      waitlistSet.add(applicationId);
    }
  });

  return {
    assignments: normalizedAssignments,
    waitlistApplicationIds: Array.from(waitlistSet),
  };
};

const generateAiMatchingPlanByGemini = async ({ recruitment, applicantRows, teamSize }) => {
  const normalizedTeamSize = Math.max(2, Math.min(8, Number(teamSize || recruitment?.teamSize || 4)));
  const fallbackPlan = buildAiMatchingPlan(applicantRows, normalizedTeamSize);
  const fallbackAssignments = toMatchingAssignments(fallbackPlan.teams);
  const fallbackValue = {
    teamAssignments: fallbackAssignments,
    waitlistApplicationIds: fallbackPlan.waitlist
      .map((applicant) => toPositiveInt(applicant?.id))
      .filter(Boolean),
    reason: "fallback",
  };

  const promptPayload = buildAiMatchingPromptPayload({
    recruitment,
    applicantRows,
    teamSize: normalizedTeamSize,
  });
  const prompt = buildGeminiMatchingPrompt(promptPayload);

  const geminiResult = await callGeminiCliJson(prompt, fallbackValue, {
    timeoutMs: GEMINI_CLI_REQUEST_TIMEOUT_MS,
    model: GEMINI_CLI_MODEL,
  });
  console.info(
    `[matching:ai] recruitment=${toPositiveInt(recruitment?.id) || "unknown"} generatedBy=${
      geminiResult.generatedBy || "unknown"
    } warning=${geminiResult.warning ? JSON.stringify(geminiResult.warning) : "none"}`,
  );

  const normalizedAssignments = normalizeGeminiTeamAssignments(geminiResult.value, applicantRows, normalizedTeamSize);
  if (!Array.isArray(normalizedAssignments.assignments) || normalizedAssignments.assignments.length === 0) {
    console.warn(
      `[matching:ai] recruitment=${toPositiveInt(recruitment?.id) || "unknown"} fallback=no-valid-assignment applicants=${applicantRows.length}`,
    );
    return {
      teams: fallbackPlan.teams,
      waitlist: fallbackPlan.waitlist,
      source: "fallback",
      warning:
        geminiResult.warning ||
        "AI 배정안에서 유효한 팀 구성을 만들지 못해 기본 로직으로 대체되었습니다.",
    };
  }

  const manualPlan = buildManualMatchingPlan(applicantRows, normalizedAssignments.assignments, normalizedTeamSize);
  if (manualPlan.error) {
    console.warn(
      `[matching:ai] recruitment=${toPositiveInt(recruitment?.id) || "unknown"} fallback=manual-validation-error message=${JSON.stringify(
        manualPlan.error?.body?.message || "",
      )}`,
    );
    return {
      teams: fallbackPlan.teams,
      waitlist: fallbackPlan.waitlist,
      source: "fallback",
      warning:
        geminiResult.warning ||
        manualPlan.error?.body?.message ||
        "AI 배정안 검증에 실패해 기본 로직으로 대체되었습니다.",
    };
  }

  return {
    teams: manualPlan.teams,
    waitlist: manualPlan.waitlist,
    source: geminiResult.generatedBy?.startsWith("gemini_cli:") ? "gemini_cli" : "fallback",
    warning: geminiResult.warning || null,
    generatedBy: geminiResult.generatedBy || null,
  };
};

const loadRecruitmentMatchingSnapshot = async (connection, recruitmentId) => {
  const [batchRows] = await connection.query(APP_QUERIES.SELECT_RECRUITMENT_MATCHING_BATCH_SUMMARY, [
    recruitmentId,
  ]);
  const latestBatch = batchRows?.[0] || null;
  const teamAssignmentByUserId = new Map();
  const waitlistOrderByUserId = new Map();

  if (!latestBatch?.id) {
    return {
      latestBatch: null,
      teamAssignmentByUserId,
      waitlistOrderByUserId,
    };
  }

  const [teamRows] = await connection.query(APP_QUERIES.SELECT_RECRUITMENT_MATCH_TEAM_ASSIGNMENTS_BY_BATCH, [
    recruitmentId,
    latestBatch.id,
  ]);
  teamRows.forEach((row) => {
    const userId = Number(row.user_id);
    if (!userId) return;
    teamAssignmentByUserId.set(userId, {
      teamNumber: Number(row.team_number || 0),
      role: normalizeString(row.role) || "member",
    });
  });

  const [waitlistRows] = await connection.query(APP_QUERIES.SELECT_RECRUITMENT_MATCH_WAITLIST_BY_BATCH, [
    recruitmentId,
    latestBatch.id,
  ]);
  waitlistRows.forEach((row) => {
    const userId = Number(row.user_id);
    const waitlistOrder = Number(row.waitlist_order || 0);
    if (!userId || !waitlistOrder) return;
    waitlistOrderByUserId.set(userId, waitlistOrder);
  });

  return {
    latestBatch,
    teamAssignmentByUserId,
    waitlistOrderByUserId,
  };
};

const loadMatchingReadyRecruitment = async (connection, recruitmentId, academyIdSet) => {
  const [recruitmentRows] = await connection.query(APP_QUERIES.SELECT_STUDY_RECRUITMENT_BY_ID, [recruitmentId]);
  if (recruitmentRows.length === 0) {
    return { error: { status: 404, body: { message: "스터디 모집 정보를 찾을 수 없습니다." } } };
  }

  const recruitment = toRecruitmentResponse(recruitmentRows[0]);
  if (!isRecruitmentVisibleToAcademySet(recruitment, academyIdSet)) {
    return { error: FORBIDDEN_RECRUITMENT_ACCESS_ERROR };
  }
  if (recruitment.status === "completed") {
    return { error: { status: 409, body: { message: "이미 매칭이 완료된 모집입니다." } } };
  }
  if (recruitment.status === "closed") {
    return { error: { status: 409, body: { message: "종료된 모집은 매칭을 실행할 수 없습니다." } } };
  }

  const [completedBatchRows] = await connection.query(APP_QUERIES.SELECT_RECRUITMENT_MATCHING_BATCH_SUMMARY, [
    recruitmentId,
  ]);
  if (completedBatchRows.length > 0) {
    return { error: { status: 409, body: { message: "이미 매칭이 완료된 모집입니다." } } };
  }

  const [applicantRows] = await connection.query(APP_QUERIES.SELECT_RECRUITMENT_APPLICANTS_FOR_MATCHING, [
    recruitmentId,
  ]);

  return { recruitment, applicantRows };
};

const executeRecruitmentMatchingPlan = async ({
  connection,
  recruitmentId,
  recruitment,
  currentUserId,
  teamSize,
  teams,
  waitlist,
  matchingSeed,
}) => {
  const normalizedTeamSize = Math.max(2, Math.min(8, Number(teamSize || recruitment.teamSize || 4)));
  const sanitizedTeams = Array.isArray(teams)
    ? teams
        .map((team, index) => ({
          teamNumber: toPositiveInt(team?.teamNumber) || index + 1,
          teamName: normalizeNullableString(team?.teamName)?.slice(0, 80) || null,
          members: Array.isArray(team?.members) ? team.members.filter(Boolean) : [],
        }))
        .filter((team) => team.members.length > 0)
    : [];
  const waitlistRows = Array.isArray(waitlist) ? waitlist.filter(Boolean) : [];
  const assignedApplicants = sanitizedTeams.reduce((sum, team) => sum + team.members.length, 0);
  const waitlistedApplicants = waitlistRows.length;
  const totalApplicants = assignedApplicants + waitlistedApplicants;

  await connection.query(APP_QUERIES.UPDATE_STUDY_RECRUITMENT_STATUS_BY_ID, ["matching", recruitmentId]);
  const [batchResult] = await connection.query(APP_QUERIES.INSERT_STUDY_MATCHING_BATCH, [
    recruitmentId,
    currentUserId,
    matchingSeed,
    totalApplicants,
    0,
    0,
    "running",
  ]);

  for (const team of sanitizedTeams) {
    const leaderApplicant =
      team.members.find((applicant) => normalizeString(applicant.presentation_level) === "presenter") ||
      team.members[0];

    const defaultGroupName = buildRecruitmentDefaultTeamName(recruitment, team.teamNumber);
    const groupName = normalizeNullableString(team.teamName)?.slice(0, 80) || defaultGroupName;
    const groupSubject = normalizeString(recruitment.targetClass) || "스터디";
    const groupDescription = normalizeNullableString(
      recruitment.reviewScope
        ? `당일 수업 복습 범위: ${recruitment.reviewScope}`
        : "매칭으로 생성된 데일리 복습 스터디 그룹입니다.",
    );

    const [groupInsertResult] = await connection.query(APP_QUERIES.INSERT_STUDY_GROUP, [
      groupName,
      groupSubject,
      groupDescription,
      leaderApplicant.user_id,
      toPositiveInt(recruitment.academyId ?? recruitment.academy_id),
      normalizedTeamSize,
    ]);

    const studyGroupId = groupInsertResult.insertId;
    await connection.query(APP_QUERIES.INSERT_STUDY_GROUP_LEADER, [studyGroupId, leaderApplicant.user_id]);

    for (const applicant of team.members) {
      if (Number(applicant.user_id) === Number(leaderApplicant.user_id)) continue;
      await connection.query(APP_QUERIES.INSERT_IGNORE_STUDY_GROUP_MEMBER, [studyGroupId, applicant.user_id]);
    }

    const firstMeetingLabel = selectFirstMeetingLabel(team.members);
    const [teamResult] = await connection.query(APP_QUERIES.INSERT_STUDY_MATCH_TEAM, [
      batchResult.insertId,
      recruitmentId,
      team.teamNumber,
      studyGroupId,
      null,
      firstMeetingLabel,
    ]);

    for (const applicant of team.members) {
      const role = Number(applicant.user_id) === Number(leaderApplicant.user_id) ? "leader" : "member";
      await connection.query(APP_QUERIES.INSERT_STUDY_MATCH_TEAM_MEMBER, [
        teamResult.insertId,
        recruitmentId,
        applicant.user_id,
        role,
      ]);
    }
  }

  if (waitlistedApplicants > 0) {
    for (let index = 0; index < waitlistRows.length; index += 1) {
      const waitlistUser = waitlistRows[index];
      await connection.query(APP_QUERIES.INSERT_STUDY_MATCH_WAITLIST, [
        batchResult.insertId,
        recruitmentId,
        waitlistUser.user_id,
        index + 1,
      ]);
    }
  }

  await connection.query(APP_QUERIES.COMPLETE_STUDY_MATCHING_BATCH, [
    assignedApplicants,
    waitlistedApplicants,
    "completed",
    "completed",
    batchResult.insertId,
  ]);
  await connection.query(APP_QUERIES.UPDATE_STUDY_RECRUITMENT_STATUS_BY_ID, ["completed", recruitmentId]);

  return {
    batchId: Number(batchResult.insertId),
    teamSize: normalizedTeamSize,
    totalApplicants,
    assignedApplicants,
    waitlistedApplicants,
    teams: sanitizedTeams.length,
  };
};

const decodeObjectPath = (encodedPath) =>
  encodedPath
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");

const resolvePathFromUrlLike = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    return normalizeString(parsed.pathname);
  } catch {
    return normalized;
  }
};

const resolveProfileImageObjectName = (profileImageUrl) => {
  const normalizedUrl = normalizeString(profileImageUrl);
  if (!normalizedUrl) return null;
  if (normalizedUrl === defaultProfileImageUrl) return null;

  const normalizedPublicBase = normalizeString(minioPublicBaseUrl).replace(/\/+$/, "");
  if (normalizedPublicBase) {
    const prefix = `${normalizedPublicBase}/`;
    if (normalizedUrl.startsWith(prefix)) {
      return decodeObjectPath(normalizedUrl.slice(prefix.length));
    }
  }

  const protocol = minioUseSSL ? "https" : "http";
  const directMinioPrefix = `${protocol}://${minioEndpoint}:${minioPort}/${minioBucket}/`;
  if (normalizedUrl.startsWith(directMinioPrefix)) {
    return decodeObjectPath(normalizedUrl.slice(directMinioPrefix.length));
  }

  const localPublicBase = normalizeString(process.env.PROFILE_IMAGE_LOCAL_PUBLIC_BASE_URL || "/api/uploads/profiles").replace(
    /\/+$/,
    "",
  );
  const urlPathname = resolvePathFromUrlLike(normalizedUrl);
  const fallbackLocalPrefixes = [localPublicBase, "/api/uploads/profiles", "/uploads/profiles"]
    .map((value) => normalizeString(value).replace(/\/+$/, ""))
    .filter(Boolean);

  for (const prefixBase of fallbackLocalPrefixes) {
    const prefix = `${prefixBase}/`;
    if (normalizedUrl.startsWith(prefix)) {
      return `local/${decodeObjectPath(normalizedUrl.slice(prefix.length))}`;
    }
    if (urlPathname.startsWith(prefix)) {
      return `local/${decodeObjectPath(urlPathname.slice(prefix.length))}`;
    }
  }

  return null;
};

let friendshipsSchemaReady = false;
let academiesSchemaReady = false;
let academiesSchemaInitPromise = null;
let studyGroupsAcademySchemaReady = false;
let studyGroupsAcademySchemaInitPromise = null;
let studyRecruitmentSchemaReady = false;
let studyRecruitmentSchemaInitPromise = null;
let studySessionLearningSchemaReady = false;
let studySessionLearningSchemaInitPromise = null;
let academyManagementSchemaReady = false;
let academyManagementSchemaInitPromise = null;
const tenantAcademySchemaReadyUsers = new Set();
const tenantAcademySchemaInitPromises = new Map();
const tenantStudyStatsSchemaReadyUsers = new Set();
const tenantStudyStatsSchemaInitPromises = new Map();
const tenantPersonalScheduleSchemaReadyUsers = new Set();
const tenantPersonalScheduleSchemaInitPromises = new Map();

const DEFAULT_ACADEMY_SEED_ROWS = [
  ["SPO 강남캠퍼스", "서울특별시 강남구 테헤란로 101", "SPO-GANGNAM-101"],
  ["SPO 서초캠퍼스", "서울특별시 서초구 서초대로 77", "SPO-SEOCHO-077"],
  ["SPO 송파캠퍼스", "서울특별시 송파구 올림픽로 35", "SPO-SONGPA-035"],
  ["SPO 분당캠퍼스", "경기도 성남시 분당구 황새울로 214", "SPO-BUNDANG-214"],
  ["SPO 인천캠퍼스", "인천광역시 연수구 센트럴로 123", "SPO-INCHEON-123"],
  ["SPO 부산캠퍼스", "부산광역시 해운대구 센텀중앙로 90", "SPO-BUSAN-090"],
];
const DEFAULT_ACADEMY_CODE_BY_NAME = new Map(
  DEFAULT_ACADEMY_SEED_ROWS.map(([name, _address, registrationCode]) => [name, registrationCode]),
);

const ensureFriendshipsTable = async () => {
  if (friendshipsSchemaReady) return;

  const connection = await pool.getConnection();
  try {
    const [tableRows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'friendships'`,
    );

    if (Number(tableRows[0]?.count || 0) === 0) {
      await connection.query(
        `CREATE TABLE friendships (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          requester_user_id BIGINT UNSIGNED NOT NULL,
          addressee_user_id BIGINT UNSIGNED NOT NULL,
          status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
          requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          responded_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_friendship_pair (requester_user_id, addressee_user_id),
          KEY idx_friendships_addressee_user_id (addressee_user_id),
          KEY idx_friendships_status (status),
          CONSTRAINT chk_friendships_not_self CHECK (requester_user_id <> addressee_user_id),
          CONSTRAINT fk_friendships_requester_user FOREIGN KEY (requester_user_id) REFERENCES users(id),
          CONSTRAINT fk_friendships_addressee_user FOREIGN KEY (addressee_user_id) REFERENCES users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      friendshipsSchemaReady = true;
      return;
    }

    const [columnRows] = await connection.query(
      `SELECT COLUMN_NAME
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'friendships'`,
    );

    const columns = new Set(columnRows.map((row) => row.COLUMN_NAME));
    if (columns.has("requester_user_id") && columns.has("addressee_user_id")) {
      friendshipsSchemaReady = true;
      return;
    }

    if (!(columns.has("user_id") && columns.has("friend_user_id"))) {
      throw new Error("friendships 테이블 스키마가 예상과 다릅니다.");
    }

    await connection.beginTransaction();
    await connection.query(`DROP TABLE IF EXISTS friendships_v2`);
    await connection.query(
      `CREATE TABLE friendships_v2 (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        requester_user_id BIGINT UNSIGNED NOT NULL,
        addressee_user_id BIGINT UNSIGNED NOT NULL,
        status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        responded_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_friendship_pair (requester_user_id, addressee_user_id),
        KEY idx_friendships_addressee_user_id (addressee_user_id),
        KEY idx_friendships_status (status),
        CONSTRAINT chk_friendships_v2_not_self CHECK (requester_user_id <> addressee_user_id),
        CONSTRAINT fk_friendships_v2_requester_user FOREIGN KEY (requester_user_id) REFERENCES users(id),
        CONSTRAINT fk_friendships_v2_addressee_user FOREIGN KEY (addressee_user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );

    await connection.query(
      `INSERT INTO friendships_v2 (
          requester_user_id,
          addressee_user_id,
          status,
          requested_at,
          responded_at,
          created_at,
          updated_at
        )
        SELECT
          user_id,
          friend_user_id,
          CASE
            WHEN status = 'accepted' THEN 'accepted'
            WHEN status = 'pending' THEN 'pending'
            ELSE 'rejected'
          END AS status,
          COALESCE(created_at, CURRENT_TIMESTAMP) AS requested_at,
          CASE WHEN status = 'accepted' THEN updated_at ELSE NULL END AS responded_at,
          created_at,
          updated_at
        FROM friendships`,
    );

    await connection.query(`RENAME TABLE friendships TO friendships_legacy, friendships_v2 TO friendships`);
    await connection.query(`DROP TABLE friendships_legacy`);
    await connection.commit();
    friendshipsSchemaReady = true;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    connection.release();
  }
};

const ensureAcademiesSchema = async () => {
  if (academiesSchemaReady) return;
  if (academiesSchemaInitPromise) {
    await academiesSchemaInitPromise;
    return;
  }

  academiesSchemaInitPromise = (async () => {
    const connection = await pool.getConnection();
    try {
      const [academyTableRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'`,
      );

      if (Number(academyTableRows[0]?.count || 0) === 0) {
        await connection.query(
          `CREATE TABLE academies (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(120) NOT NULL,
            address VARCHAR(255) NULL,
            business_registration_number VARCHAR(30) NULL,
            registration_code VARCHAR(40) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_academies_name (name),
            UNIQUE KEY uq_academies_business_registration_number (business_registration_number),
            KEY idx_academies_is_active (is_active)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        );
      }

      const [academyRegistrationCodeColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'
           AND column_name = 'registration_code'`,
      );

      if (Number(academyRegistrationCodeColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academies
           ADD COLUMN registration_code VARCHAR(40) NULL AFTER address`,
        );
      }

      const [academyBusinessColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'
           AND column_name = 'business_registration_number'`,
      );

      if (Number(academyBusinessColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academies
           ADD COLUMN business_registration_number VARCHAR(30) NULL AFTER address`,
        );
      }

      const [academyBusinessIndexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'academies'
           AND index_name = 'uq_academies_business_registration_number'`,
      );

      if (Number(academyBusinessIndexRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academies
           ADD UNIQUE KEY uq_academies_business_registration_number (business_registration_number)`,
        );
      }

      const [academyCountRows] = await connection.query(`SELECT COUNT(*) AS count FROM academies`);
      if (Number(academyCountRows[0]?.count || 0) === 0) {
        await connection.query(
          `INSERT INTO academies (name, address, registration_code)
           VALUES ?`,
          [DEFAULT_ACADEMY_SEED_ROWS],
        );
      }

      const [missingRegistrationCodeRows] = await connection.query(
        `SELECT id, name
         FROM academies
         WHERE registration_code IS NULL
            OR TRIM(registration_code) = ''`,
      );

      for (const row of missingRegistrationCodeRows) {
        const fallbackCode = DEFAULT_ACADEMY_CODE_BY_NAME.get(row.name) || `SPO${String(row.id).padStart(6, "0")}`;
        await connection.query(`UPDATE academies SET registration_code = ? WHERE id = ?`, [fallbackCode, row.id]);
      }

      academiesSchemaReady = true;
    } finally {
      connection.release();
    }
  })()
    .catch((error) => {
      academiesSchemaInitPromise = null;
      throw error;
    })
    .finally(() => {
      if (academiesSchemaReady) {
        academiesSchemaInitPromise = null;
      }
    });

  await academiesSchemaInitPromise;
};

const ensureStudyGroupsAcademySchema = async () => {
  if (studyGroupsAcademySchemaReady) return;
  if (studyGroupsAcademySchemaInitPromise) {
    await studyGroupsAcademySchemaInitPromise;
    return;
  }

  await ensureAcademiesSchema();

  studyGroupsAcademySchemaInitPromise = (async () => {
    const connection = await pool.getConnection();
    try {
      const [academyIdColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_groups'
           AND column_name = 'academy_id'`,
      );

      if (Number(academyIdColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_groups
           ADD COLUMN academy_id BIGINT UNSIGNED NULL AFTER created_by`,
        );
      }

      const [academyIndexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'study_groups'
           AND index_name = 'idx_study_groups_academy_id'`,
      );

      if (Number(academyIndexRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_groups
           ADD KEY idx_study_groups_academy_id (academy_id)`,
        );
      }

      const [academyForeignKeyRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.table_constraints
         WHERE table_schema = DATABASE()
           AND table_name = 'study_groups'
           AND constraint_name = 'fk_study_groups_academy'
           AND constraint_type = 'FOREIGN KEY'`,
      );

      if (Number(academyForeignKeyRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_groups
           ADD CONSTRAINT fk_study_groups_academy
           FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE SET NULL`,
        );
      }

      studyGroupsAcademySchemaReady = true;
    } finally {
      connection.release();
    }
  })()
    .catch((error) => {
      studyGroupsAcademySchemaInitPromise = null;
      throw error;
    })
    .finally(() => {
      if (studyGroupsAcademySchemaReady) {
        studyGroupsAcademySchemaInitPromise = null;
      }
    });

  await studyGroupsAcademySchemaInitPromise;
};

const ensureAcademyManagementSchema = async () => {
  if (academyManagementSchemaReady) return;
  if (academyManagementSchemaInitPromise) {
    await academyManagementSchemaInitPromise;
    return;
  }

  await ensureStudyGroupsAcademySchema();

  academyManagementSchemaInitPromise = (async () => {
    const connection = await pool.getConnection();
    try {
      await connection.query(
        `CREATE TABLE IF NOT EXISTS academy_notices (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          academy_id BIGINT UNSIGNED NOT NULL,
          study_group_id BIGINT UNSIGNED NULL,
          title VARCHAR(160) NOT NULL,
          content TEXT NOT NULL,
          notice_image_url VARCHAR(1024) NULL,
          created_by BIGINT UNSIGNED NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_academy_notices_academy_id (academy_id),
          KEY idx_academy_notices_study_group_id (study_group_id),
          CONSTRAINT fk_academy_notices_academy FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
          CONSTRAINT fk_academy_notices_study_group FOREIGN KEY (study_group_id) REFERENCES study_groups(id) ON DELETE SET NULL,
          CONSTRAINT fk_academy_notices_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      const [noticeStudyGroupColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_notices'
           AND column_name = 'study_group_id'`,
      );

      if (Number(noticeStudyGroupColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_notices
           ADD COLUMN study_group_id BIGINT UNSIGNED NULL AFTER academy_id`,
        );
      }

      const [noticeImageColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_notices'
           AND column_name = 'notice_image_url'`,
      );

      if (Number(noticeImageColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_notices
           ADD COLUMN notice_image_url VARCHAR(1024) NULL AFTER content`,
        );
      }

      const [noticeStudyGroupIndexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_notices'
           AND index_name = 'idx_academy_notices_study_group_id'`,
      );

      if (Number(noticeStudyGroupIndexRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_notices
           ADD KEY idx_academy_notices_study_group_id (study_group_id)`,
        );
      }

      const [noticeStudyGroupForeignKeyRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.table_constraints
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_notices'
           AND constraint_name = 'fk_academy_notices_study_group'
           AND constraint_type = 'FOREIGN KEY'`,
      );

      if (Number(noticeStudyGroupForeignKeyRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_notices
           ADD CONSTRAINT fk_academy_notices_study_group
           FOREIGN KEY (study_group_id) REFERENCES study_groups(id) ON DELETE SET NULL`,
        );
      }

      await connection.query(
        `CREATE TABLE IF NOT EXISTS academy_reward_settings (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          academy_id BIGINT UNSIGNED NOT NULL,
          absence_pass_probability DECIMAL(5,2) NOT NULL DEFAULT 4.00,
          gifticon_probability DECIMAL(5,2) NOT NULL DEFAULT 4.00,
          miss_probability DECIMAL(5,2) NOT NULL DEFAULT 92.00,
          daily_spin_limit INT UNSIGNED NOT NULL DEFAULT 2,
          attendance_rate_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00,
          monthly_attendance_min_count INT UNSIGNED NOT NULL DEFAULT 0,
          reward_description VARCHAR(255) NULL,
          created_by BIGINT UNSIGNED NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_academy_reward_settings_academy (academy_id),
          CONSTRAINT fk_academy_reward_settings_academy FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE CASCADE,
          CONSTRAINT fk_academy_reward_settings_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      const [attendanceThresholdColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_reward_settings'
           AND column_name = 'attendance_rate_threshold'`,
      );
      if (Number(attendanceThresholdColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_reward_settings
           ADD COLUMN attendance_rate_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00 AFTER daily_spin_limit`,
        );
      }

      const [monthlyAttendanceMinCountColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_reward_settings'
           AND column_name = 'monthly_attendance_min_count'`,
      );
      if (Number(monthlyAttendanceMinCountColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_reward_settings
           ADD COLUMN monthly_attendance_min_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER attendance_rate_threshold`,
        );
      }

      const [rewardDescriptionColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'academy_reward_settings'
           AND column_name = 'reward_description'`,
      );
      if (Number(rewardDescriptionColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE academy_reward_settings
           ADD COLUMN reward_description VARCHAR(255) NULL AFTER attendance_rate_threshold`,
        );
      }

      await connection.query(
        `CREATE TABLE IF NOT EXISTS reward_spin_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NOT NULL,
          academy_id BIGINT UNSIGNED NULL,
          study_group_id BIGINT UNSIGNED NOT NULL,
          reward_type ENUM('absence-pass', 'gifticon', 'miss') NOT NULL,
          reward_label VARCHAR(120) NOT NULL,
          spun_on DATE NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_reward_spin_logs_user_day (user_id, spun_on),
          KEY idx_reward_spin_logs_study_group_id (study_group_id),
          CONSTRAINT fk_reward_spin_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_reward_spin_logs_academy FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE SET NULL,
          CONSTRAINT fk_reward_spin_logs_study_group FOREIGN KEY (study_group_id) REFERENCES study_groups(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      await connection.query(
        `CREATE TABLE IF NOT EXISTS reward_inventories (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NOT NULL,
          study_group_id BIGINT UNSIGNED NOT NULL,
          reward_type ENUM('absence-pass') NOT NULL,
          quantity INT UNSIGNED NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_reward_inventory_user_group_type (user_id, study_group_id, reward_type),
          CONSTRAINT fk_reward_inventory_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_reward_inventory_group FOREIGN KEY (study_group_id) REFERENCES study_groups(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      academyManagementSchemaReady = true;
    } finally {
      connection.release();
    }
  })()
    .catch((error) => {
      academyManagementSchemaInitPromise = null;
      throw error;
    })
    .finally(() => {
      if (academyManagementSchemaReady) {
        academyManagementSchemaInitPromise = null;
      }
    });

  await academyManagementSchemaInitPromise;
};

const ensureStudyRecruitmentSchema = async () => {
  if (studyRecruitmentSchemaReady) return;
  if (studyRecruitmentSchemaInitPromise) {
    await studyRecruitmentSchemaInitPromise;
    return;
  }

  await ensureAcademiesSchema();

  studyRecruitmentSchemaInitPromise = (async () => {
    const connection = await pool.getConnection();
    try {
      await connection.query(
        `CREATE TABLE IF NOT EXISTS study_recruitments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          academy_id BIGINT UNSIGNED NULL,
          title VARCHAR(160) NOT NULL,
          target_class VARCHAR(120) NULL,
          review_scope TEXT NULL,
          ai_topic_examples TEXT NULL,
          recruitment_start_at DATETIME NOT NULL,
          recruitment_end_at DATETIME NOT NULL,
          min_applicants INT UNSIGNED NULL,
          max_applicants INT UNSIGNED NULL,
          team_size INT UNSIGNED NOT NULL DEFAULT 4,
          matching_guide TEXT NULL,
          application_check_config TEXT NULL,
          status ENUM('open', 'matching', 'completed', 'closed') NOT NULL DEFAULT 'open',
          created_by BIGINT UNSIGNED NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_study_recruitments_academy_id (academy_id),
          KEY idx_study_recruitments_status (status),
          KEY idx_study_recruitments_recruitment_end_at (recruitment_end_at),
          CONSTRAINT fk_study_recruitments_academy FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE SET NULL,
          CONSTRAINT fk_study_recruitments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      const [academyIdColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_recruitments'
           AND column_name = 'academy_id'`,
      );
      if (Number(academyIdColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_recruitments
           ADD COLUMN academy_id BIGINT UNSIGNED NULL AFTER id`,
        );
      }

      const [academyIndexRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'study_recruitments'
           AND index_name = 'idx_study_recruitments_academy_id'`,
      );
      if (Number(academyIndexRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_recruitments
           ADD KEY idx_study_recruitments_academy_id (academy_id)`,
        );
      }

      const [academyForeignKeyRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.table_constraints
         WHERE table_schema = DATABASE()
           AND table_name = 'study_recruitments'
           AND constraint_name = 'fk_study_recruitments_academy'
           AND constraint_type = 'FOREIGN KEY'`,
      );
      if (Number(academyForeignKeyRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_recruitments
           ADD CONSTRAINT fk_study_recruitments_academy
           FOREIGN KEY (academy_id) REFERENCES academies(id) ON DELETE SET NULL`,
        );
      }

      const [applicationCheckConfigColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_recruitments'
           AND column_name = 'application_check_config'`,
      );
      if (Number(applicationCheckConfigColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_recruitments
           ADD COLUMN application_check_config TEXT NULL AFTER matching_guide`,
        );
      }

      const [activeAcademyRows] = await connection.query(
        `SELECT id
         FROM academies
         WHERE is_active = 1
         ORDER BY id ASC`,
      );
      const defaultAcademyId = toPositiveInt(activeAcademyRows[0]?.id);
      if (defaultAcademyId) {
        await connection.query(`UPDATE study_recruitments SET academy_id = ? WHERE academy_id IS NULL`, [
          defaultAcademyId,
        ]);
      }

      await connection.query(
        `CREATE TABLE IF NOT EXISTS study_recruitment_applications (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          recruitment_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          participation_intent ENUM('join', 'skip') NOT NULL DEFAULT 'join',
          available_time_slots TEXT NULL,
          preferred_style VARCHAR(120) NULL,
          mbti_type VARCHAR(8) NULL,
          custom_responses TEXT NULL,
          presentation_level ENUM('passive', 'normal', 'presenter') NOT NULL DEFAULT 'normal',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_study_recruitment_applications_recruitment_user (recruitment_id, user_id),
          KEY idx_study_recruitment_applications_user_id (user_id),
          KEY idx_study_recruitment_applications_intent (participation_intent),
          CONSTRAINT fk_study_recruitment_applications_recruitment FOREIGN KEY (recruitment_id) REFERENCES study_recruitments(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_recruitment_applications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      const [mbtiColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_recruitment_applications'
           AND column_name = 'mbti_type'`,
      );
      if (Number(mbtiColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_recruitment_applications
           ADD COLUMN mbti_type VARCHAR(8) NULL AFTER preferred_style`,
        );
      }

      const [customResponsesColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_recruitment_applications'
           AND column_name = 'custom_responses'`,
      );
      if (Number(customResponsesColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_recruitment_applications
           ADD COLUMN custom_responses TEXT NULL AFTER mbti_type`,
        );
      }

      await connection.query(
        `CREATE TABLE IF NOT EXISTS study_matching_batches (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          recruitment_id BIGINT UNSIGNED NOT NULL,
          requested_by_user_id BIGINT UNSIGNED NOT NULL,
          matching_seed VARCHAR(64) NOT NULL,
          total_applicants INT UNSIGNED NOT NULL DEFAULT 0,
          assigned_applicants INT UNSIGNED NOT NULL DEFAULT 0,
          waitlisted_applicants INT UNSIGNED NOT NULL DEFAULT 0,
          status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
          completed_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_study_matching_batches_recruitment_id (recruitment_id),
          KEY idx_study_matching_batches_status (status),
          CONSTRAINT fk_study_matching_batches_recruitment FOREIGN KEY (recruitment_id) REFERENCES study_recruitments(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_matching_batches_requested_by_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      await connection.query(
        `CREATE TABLE IF NOT EXISTS study_match_teams (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          batch_id BIGINT UNSIGNED NOT NULL,
          recruitment_id BIGINT UNSIGNED NOT NULL,
          team_number INT UNSIGNED NOT NULL,
          study_group_id BIGINT UNSIGNED NULL,
          first_meeting_at DATETIME NULL,
          first_meeting_label VARCHAR(80) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_study_match_teams_batch_team_number (batch_id, team_number),
          KEY idx_study_match_teams_recruitment_id (recruitment_id),
          KEY idx_study_match_teams_study_group_id (study_group_id),
          CONSTRAINT fk_study_match_teams_batch FOREIGN KEY (batch_id) REFERENCES study_matching_batches(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_match_teams_recruitment FOREIGN KEY (recruitment_id) REFERENCES study_recruitments(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_match_teams_study_group FOREIGN KEY (study_group_id) REFERENCES study_groups(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      await connection.query(
        `CREATE TABLE IF NOT EXISTS study_match_team_members (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          team_id BIGINT UNSIGNED NOT NULL,
          recruitment_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          role ENUM('leader', 'member') NOT NULL DEFAULT 'member',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_study_match_team_members_team_user (team_id, user_id),
          UNIQUE KEY uq_study_match_team_members_recruitment_user (recruitment_id, user_id),
          KEY idx_study_match_team_members_user_id (user_id),
          CONSTRAINT fk_study_match_team_members_team FOREIGN KEY (team_id) REFERENCES study_match_teams(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_match_team_members_recruitment FOREIGN KEY (recruitment_id) REFERENCES study_recruitments(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_match_team_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      await connection.query(
        `CREATE TABLE IF NOT EXISTS study_match_waitlist (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          batch_id BIGINT UNSIGNED NOT NULL,
          recruitment_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          waitlist_order INT UNSIGNED NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_study_match_waitlist_batch_user (batch_id, user_id),
          UNIQUE KEY uq_study_match_waitlist_recruitment_user (recruitment_id, user_id),
          KEY idx_study_match_waitlist_recruitment_order (recruitment_id, waitlist_order),
          CONSTRAINT fk_study_match_waitlist_batch FOREIGN KEY (batch_id) REFERENCES study_matching_batches(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_match_waitlist_recruitment FOREIGN KEY (recruitment_id) REFERENCES study_recruitments(id) ON DELETE CASCADE,
          CONSTRAINT fk_study_match_waitlist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      studyRecruitmentSchemaReady = true;
    } finally {
      connection.release();
    }
  })()
    .catch((error) => {
      studyRecruitmentSchemaInitPromise = null;
      throw error;
    })
    .finally(() => {
      if (studyRecruitmentSchemaReady) {
        studyRecruitmentSchemaInitPromise = null;
      }
    });

  await studyRecruitmentSchemaInitPromise;
};

const ensureStudySessionLearningSchema = async () => {
  if (studySessionLearningSchemaReady) return;
  if (studySessionLearningSchemaInitPromise) {
    await studySessionLearningSchemaInitPromise;
    return;
  }

  studySessionLearningSchemaInitPromise = (async () => {
    const connection = await pool.getConnection();
    try {
      const [studySessionTableRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = 'study_sessions'`,
      );

      if (Number(studySessionTableRows[0]?.count || 0) === 0) {
        studySessionLearningSchemaReady = true;
        return;
      }

      const [studyDurationColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_sessions'
           AND column_name = 'study_duration_minutes'`,
      );
      if (Number(studyDurationColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_sessions
           ADD COLUMN study_duration_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER ended_at`,
        );
      }

      const [topicDescriptionColumnRows] = await connection.query(
        `SELECT DATA_TYPE AS data_type
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_sessions'
           AND column_name = 'topic_description'
         LIMIT 1`,
      );
      const topicDescriptionDataType = String(topicDescriptionColumnRows[0]?.data_type || "").toLowerCase();
      if (topicDescriptionDataType === "text") {
        await connection.query(
          `ALTER TABLE study_sessions
           MODIFY COLUMN topic_description LONGTEXT NULL`,
        );
      }

      const [studyStartedAtColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_sessions'
           AND column_name = 'study_started_at'`,
      );
      if (Number(studyStartedAtColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_sessions
           ADD COLUMN study_started_at DATETIME NULL AFTER scheduled_start_at`,
        );
      }

      const [aiReviewedAtColumnRows] = await connection.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'study_sessions'
           AND column_name = 'ai_reviewed_at'`,
      );
      if (Number(aiReviewedAtColumnRows[0]?.count || 0) === 0) {
        await connection.query(
          `ALTER TABLE study_sessions
           ADD COLUMN ai_reviewed_at DATETIME NULL AFTER study_started_at`,
        );
      }

      studySessionLearningSchemaReady = true;
    } finally {
      connection.release();
    }
  })()
    .catch((error) => {
      studySessionLearningSchemaInitPromise = null;
      throw error;
    })
    .finally(() => {
      if (studySessionLearningSchemaReady) {
        studySessionLearningSchemaInitPromise = null;
      }
    });

  await studySessionLearningSchemaInitPromise;
};

const ensureTenantAcademiesSchemaByUserId = async (userId) => {
  if (tenantAcademySchemaReadyUsers.has(userId)) {
    return;
  }
  if (tenantAcademySchemaInitPromises.has(userId)) {
    await tenantAcademySchemaInitPromises.get(userId);
    return;
  }

  const initPromise = (async () => {
    const { pool: tenantPool } = await getTenantPool(userId);
    const tenantConnection = await tenantPool.getConnection();
    try {
      await tenantConnection.query(
        `CREATE TABLE IF NOT EXISTS user_academies (
          academy_id BIGINT UNSIGNED NOT NULL,
          registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (academy_id),
          KEY idx_user_academies_registered_at (registered_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      tenantAcademySchemaReadyUsers.add(userId);
    } catch (error) {
      const tenantDbName = buildTenantDatabaseName(userId);
      error.message = `[${tenantDbName}] 테넌트 DB 초기화 실패: ${error.message}`;
      throw error;
    } finally {
      tenantConnection.release();
    }
  })()
    .catch((error) => {
      tenantAcademySchemaInitPromises.delete(userId);
      throw error;
    })
    .finally(() => {
      if (tenantAcademySchemaReadyUsers.has(userId)) {
        tenantAcademySchemaInitPromises.delete(userId);
      }
    });

  tenantAcademySchemaInitPromises.set(userId, initPromise);
  await initPromise;
};

const ensureTenantStudyStatsSchemaByUserId = async (userId) => {
  if (tenantStudyStatsSchemaReadyUsers.has(userId)) {
    return;
  }
  if (tenantStudyStatsSchemaInitPromises.has(userId)) {
    await tenantStudyStatsSchemaInitPromises.get(userId);
    return;
  }

  const initPromise = (async () => {
    const { pool: tenantPool } = await getTenantPool(userId);
    const tenantConnection = await tenantPool.getConnection();
    try {
      await tenantConnection.query(
        `CREATE TABLE IF NOT EXISTS user_study_stats (
          stat_key TINYINT UNSIGNED NOT NULL,
          total_study_minutes INT UNSIGNED NOT NULL DEFAULT 0,
          total_attendance_count INT UNSIGNED NOT NULL DEFAULT 0,
          total_absence_count INT UNSIGNED NOT NULL DEFAULT 0,
          current_streak_days INT UNSIGNED NOT NULL DEFAULT 0,
          participation_score DECIMAL(5,2) NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (stat_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      tenantStudyStatsSchemaReadyUsers.add(userId);
    } catch (error) {
      const tenantDbName = buildTenantDatabaseName(userId);
      error.message = `[${tenantDbName}] 테넌트 학습 통계 스키마 초기화 실패: ${error.message}`;
      throw error;
    } finally {
      tenantConnection.release();
    }
  })()
    .catch((error) => {
      tenantStudyStatsSchemaInitPromises.delete(userId);
      throw error;
    })
    .finally(() => {
      if (tenantStudyStatsSchemaReadyUsers.has(userId)) {
        tenantStudyStatsSchemaInitPromises.delete(userId);
      }
    });

  tenantStudyStatsSchemaInitPromises.set(userId, initPromise);
  await initPromise;
};

const ensureTenantPersonalScheduleSchemaByUserId = async (userId) => {
  if (tenantPersonalScheduleSchemaReadyUsers.has(userId)) {
    return;
  }
  if (tenantPersonalScheduleSchemaInitPromises.has(userId)) {
    await tenantPersonalScheduleSchemaInitPromises.get(userId);
    return;
  }

  const initPromise = (async () => {
    const { pool: tenantPool } = await getTenantPool(userId);
    const tenantConnection = await tenantPool.getConnection();
    try {
      await tenantConnection.query(
        `CREATE TABLE IF NOT EXISTS personal_schedules (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          schedule_date DATE NOT NULL,
          schedule_time TIME NOT NULL DEFAULT '09:00:00',
          title VARCHAR(120) NOT NULL,
          note VARCHAR(1000) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_personal_schedules_date_time (schedule_date, schedule_time),
          KEY idx_personal_schedules_updated_at (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );

      tenantPersonalScheduleSchemaReadyUsers.add(userId);
    } catch (error) {
      const tenantDbName = buildTenantDatabaseName(userId);
      error.message = `[${tenantDbName}] 개인 일정 스키마 초기화 실패: ${error.message}`;
      throw error;
    } finally {
      tenantConnection.release();
    }
  })()
    .catch((error) => {
      tenantPersonalScheduleSchemaInitPromises.delete(userId);
      throw error;
    })
    .finally(() => {
      if (tenantPersonalScheduleSchemaReadyUsers.has(userId)) {
        tenantPersonalScheduleSchemaInitPromises.delete(userId);
      }
    });

  tenantPersonalScheduleSchemaInitPromises.set(userId, initPromise);
  await initPromise;
};

const upsertTenantStudyStatsByUserId = async (userId, stats) => {
  await ensureTenantStudyStatsSchemaByUserId(userId);
  const { pool: tenantPool } = await getTenantPool(userId);

  await tenantPool.query(
    `INSERT INTO user_study_stats (
       stat_key,
       total_study_minutes,
       total_attendance_count,
       total_absence_count,
       current_streak_days,
       participation_score
     )
     VALUES (1, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       total_study_minutes = VALUES(total_study_minutes),
       total_attendance_count = VALUES(total_attendance_count),
       total_absence_count = VALUES(total_absence_count),
       current_streak_days = VALUES(current_streak_days),
       participation_score = VALUES(participation_score)`,
    [
      Number(stats.totalStudyMinutes || 0),
      Number(stats.totalAttendanceCount || 0),
      Number(stats.totalAbsenceCount || 0),
      Number(stats.currentStreakDays || 0),
      Number(stats.participationScore || 0),
    ],
  );
};

const getTenantStudyStatsByUserId = async (userId) => {
  await ensureTenantStudyStatsSchemaByUserId(userId);
  const { pool: tenantPool } = await getTenantPool(userId);
  const [rows] = await tenantPool.query(
    `SELECT total_study_minutes,
            total_attendance_count,
            total_absence_count,
            current_streak_days,
            participation_score,
            updated_at
     FROM user_study_stats
     WHERE stat_key = 1
     LIMIT 1`,
  );
  return rows[0] || null;
};

const getUserStudyStatsByUserId = async (userId) => {
  const tenantStats = await getTenantStudyStatsByUserId(userId);
  if (tenantStats) return tenantStats;

  const [legacyRows] = await pool.query(APP_QUERIES.SELECT_USER_STUDY_STATS_BY_USER_ID, [userId]);
  const legacyStats = legacyRows[0] || null;
  if (!legacyStats) return null;

  await upsertTenantStudyStatsByUserId(userId, {
    totalStudyMinutes: Number(legacyStats.total_study_minutes || 0),
    totalAttendanceCount: Number(legacyStats.total_attendance_count || 0),
    totalAbsenceCount: Number(legacyStats.total_absence_count || 0),
    currentStreakDays: Number(legacyStats.current_streak_days || 0),
    participationScore: Number(legacyStats.participation_score || 0),
  });

  return legacyStats;
};

const listUserAcademiesFromTenant = async (userId) => {
  await ensureTenantAcademiesSchemaByUserId(userId);
  const { pool: tenantPool } = await getTenantPool(userId);
  const [tenantRows] = await tenantPool.query(
    `SELECT academy_id, registered_at
     FROM user_academies
     ORDER BY registered_at DESC, academy_id DESC`,
  );

  if (tenantRows.length === 0) {
    return [];
  }

  const academyIds = tenantRows.map((row) => Number(row.academy_id)).filter((id) => Number.isInteger(id) && id > 0);
  if (academyIds.length === 0) {
    return [];
  }

  const placeholders = academyIds.map(() => "?").join(", ");
  const [academyRows] = await pool.query(
    `SELECT id, name, address
     FROM academies
     WHERE is_active = 1
       AND id IN (${placeholders})`,
    academyIds,
  );

  const academyById = new Map(academyRows.map((row) => [Number(row.id), row]));

  return tenantRows
    .map((row) => {
      const academy = academyById.get(Number(row.academy_id));
      if (!academy) return null;
      return mapAcademy({
        ...academy,
        registered_at: row.registered_at || null,
      });
    })
    .filter(Boolean);
};

const getUserAcademyAccessContext = async (userId) => {
  await ensureAcademiesSchema();
  await ensureTenantAcademiesSchemaByUserId(userId);

  const userAcademies = await listUserAcademiesFromTenant(userId);
  const academyIds = toUserAcademyIds(userAcademies);

  return {
    userAcademies,
    academyIds,
    academyIdSet: new Set(academyIds),
  };
};

const getPrimaryAcademyIdForUser = async (userId) => {
  const { academyIds } = await getUserAcademyAccessContext(userId);
  return academyIds[0] || null;
};

const quoteSqlIdentifier = (value) => `\`${String(value).replace(/`/g, "``")}\``;

const listAcademyMembershipRowsByUserId = async (userId, academyIds) => {
  const normalizedUserId = toPositiveInt(userId);
  const normalizedAcademyIds = Array.isArray(academyIds)
    ? academyIds.map((academyId) => toPositiveInt(academyId)).filter(Boolean)
    : [];
  if (!normalizedUserId || normalizedAcademyIds.length === 0) return [];

  const tenantDatabaseName = buildTenantDatabaseName(normalizedUserId);
  const placeholders = normalizedAcademyIds.map(() => "?").join(", ");

  try {
    const [rows] = await pool.query(
      `SELECT academy_id, registered_at
       FROM ${quoteSqlIdentifier(tenantDatabaseName)}.user_academies
       WHERE academy_id IN (${placeholders})
       ORDER BY registered_at DESC, academy_id DESC`,
      normalizedAcademyIds,
    );
    return rows;
  } catch (error) {
    const errorCode = String(error?.code || "");
    if (errorCode === "ER_BAD_DB_ERROR" || errorCode === "ER_NO_SUCH_TABLE") {
      return [];
    }
    throw error;
  }
};

const listAcademyStudents = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!isOperatorUser(currentUser.user)) {
    return { status: 403, body: { message: "운영자 권한이 필요합니다." } };
  }

  await ensureAcademiesSchema();
  await ensureTenantAcademiesSchemaByUserId(currentUser.user.id);

  const { academyIds } = await getUserAcademyAccessContext(currentUser.user.id);
  const keyword = normalizeString(req.query.q).slice(0, 80);
  const page = Math.max(1, toPositiveInt(req.query.page) || 1);
  const pageSize = Math.max(5, Math.min(30, toPositiveInt(req.query.pageSize) || 10));

  if (academyIds.length === 0) {
    return {
      status: 200,
      body: {
        message: "등록한 학원이 없어 학생 목록이 비어 있습니다.",
        students: [],
        page: 1,
        pageSize,
        total: 0,
        totalPages: 1,
      },
    };
  }

  const [academyRows] = await pool.query(
    `SELECT id, name
     FROM academies
     WHERE id IN (${academyIds.map(() => "?").join(", ")})`,
    academyIds,
  );
  const academyNameById = new Map(
    academyRows.map((row) => [Number(row.id), normalizeString(row.name)]).filter(([id, name]) => id && name),
  );

  const whereClauses = [`u.role = 'student'`];
  const params = [];
  if (keyword) {
    whereClauses.push(
      `(u.name LIKE CONCAT('%', ?, '%')
        OR u.login_id LIKE CONCAT('%', ?, '%')
        OR u.email LIKE CONCAT('%', ?, '%'))`,
    );
    params.push(keyword, keyword, keyword);
  }

  const buildStudentsFromCandidates = async (candidateRows) => {
    if (!Array.isArray(candidateRows) || candidateRows.length === 0) return [];

    const academyMembershipByUserId = new Map();
    const membershipBatchSize = 20;

    for (let index = 0; index < candidateRows.length; index += membershipBatchSize) {
      const batch = candidateRows.slice(index, index + membershipBatchSize);
      const membershipRowsBatch = await Promise.all(
        batch.map(async (row) => ({
          userId: Number(row.id),
          memberships: await listAcademyMembershipRowsByUserId(Number(row.id), academyIds),
        })),
      );
      membershipRowsBatch.forEach((row) => {
        academyMembershipByUserId.set(row.userId, row.memberships);
      });
    }

    return candidateRows
      .map((row) => {
        const userId = Number(row.id);
        const memberships = Array.isArray(academyMembershipByUserId.get(userId))
          ? academyMembershipByUserId.get(userId)
          : [];
        if (memberships.length === 0) return null;

        const academies = memberships
          .map((membership) => {
            const academyId = Number(membership.academy_id || 0);
            if (!academyId) return null;
            const academyName = academyNameById.get(academyId);
            if (!academyName) return null;
            return {
              id: academyId,
              name: academyName,
              registeredAt: membership.registered_at || null,
            };
          })
          .filter(Boolean);

        if (academies.length === 0) return null;

        return {
          id: userId,
          loginId: normalizeString(row.login_id),
          email: normalizeString(row.email),
          name: normalizeString(row.name),
          profileImageUrl: normalizeString(row.profile_image_url) || null,
          status: normalizeString(row.status) || null,
          createdAt: row.created_at || null,
          academyCount: academies.length,
          academies,
        };
      })
      .filter(Boolean);
  };

  const startIndex = (page - 1) * pageSize;
  const endIndexExclusive = startIndex + pageSize;
  const requiredMatchedCount = endIndexExclusive + 1;
  const candidateBatchSize = Math.max(120, pageSize * 12);
  const maxCandidateScan = 2400;

  let candidateOffset = 0;
  let scannedCandidateCount = 0;
  let reachedCandidateEnd = false;
  const matchedStudents = [];

  while (matchedStudents.length < requiredMatchedCount && scannedCandidateCount < maxCandidateScan) {
    const remainingScanBudget = maxCandidateScan - scannedCandidateCount;
    const currentBatchLimit = Math.min(candidateBatchSize, remainingScanBudget);
    if (currentBatchLimit <= 0) break;

    const [candidateRows] = await pool.query(
      `SELECT u.id,
              u.login_id,
              u.email,
              u.name,
              u.profile_image_url,
              u.status,
              u.created_at
       FROM users u
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ? OFFSET ?`,
      [...params, currentBatchLimit, candidateOffset],
    );

    if (candidateRows.length === 0) {
      reachedCandidateEnd = true;
      break;
    }

    scannedCandidateCount += candidateRows.length;
    candidateOffset += candidateRows.length;

    const studentsFromBatch = await buildStudentsFromCandidates(candidateRows);
    if (studentsFromBatch.length > 0) {
      matchedStudents.push(...studentsFromBatch);
    }

    if (candidateRows.length < currentBatchLimit) {
      reachedCandidateEnd = true;
      break;
    }
  }

  const hasMoreCandidates =
    matchedStudents.length > endIndexExclusive || (!reachedCandidateEnd && scannedCandidateCount >= maxCandidateScan);
  let safePage = page;

  if (matchedStudents.length <= startIndex && page > 1 && !hasMoreCandidates) {
    const resolvedTotalPages = Math.max(1, Math.ceil(matchedStudents.length / pageSize));
    safePage = Math.min(page, resolvedTotalPages);
  }

  const safeStartIndex = (safePage - 1) * pageSize;
  const safeEndIndexExclusive = safeStartIndex + pageSize;
  const paginatedStudents = matchedStudents.slice(safeStartIndex, safeEndIndexExclusive);
  const hasMoreForSafePage =
    matchedStudents.length > safeEndIndexExclusive || (safePage === page && hasMoreCandidates);

  const inferredTotal = hasMoreForSafePage
    ? safeEndIndexExclusive + 1
    : safeStartIndex + paginatedStudents.length;
  const total = Math.max(0, inferredTotal);
  const totalPages = hasMoreForSafePage
    ? Math.max(safePage + 1, Math.ceil(Math.max(1, total) / pageSize))
    : Math.max(1, Math.ceil(Math.max(1, total) / pageSize));

  return {
    status: 200,
    body: {
      message: "학원 등록 학생 목록입니다.",
      students: paginatedStudents,
      page: Math.max(1, safePage),
      pageSize,
      total,
      totalPages,
    },
  };
};

const findFriendshipBetweenUsers = async (connection, userId, otherUserId) => {
  const [rows] = await connection.query(
    `SELECT *
     FROM friendships
     WHERE (requester_user_id = ? AND addressee_user_id = ?)
        OR (requester_user_id = ? AND addressee_user_id = ?)
     LIMIT 1`,
    [userId, otherUserId, otherUserId, userId],
  );

  return rows[0] || null;
};

const listFriends = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureFriendshipsTable();

  const [rows] = await pool.query(
    `SELECT DISTINCT
        u.id,
        u.login_id,
        u.email,
        u.name,
        u.profile_image_url,
        u.role,
        u.status AS user_status,
        u.created_at
     FROM friendships f
     JOIN users u
       ON u.id = CASE
         WHEN f.requester_user_id = ? THEN f.addressee_user_id
         ELSE f.requester_user_id
       END
     WHERE (f.requester_user_id = ? OR f.addressee_user_id = ?)
       AND f.status = 'accepted'
     ORDER BY u.name ASC`,
    [currentUser.user.id, currentUser.user.id, currentUser.user.id],
  );

  return {
    status: 200,
    body: {
      message: "친구 목록입니다.",
      friends: rows.map(mapFriend),
    },
  };
};

const listFriendRequests = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureFriendshipsTable();

  const [rows] = await pool.query(
    `SELECT
        f.id,
        f.requester_user_id,
        f.addressee_user_id,
        f.status AS friendship_status,
        f.requested_at,
        f.responded_at,
        requester.id AS requester_id,
        requester.login_id AS requester_login_id,
        requester.email AS requester_email,
        requester.name AS requester_name,
        requester.profile_image_url AS requester_profile_image_url,
        requester.role AS requester_role,
        requester.status AS requester_account_status,
        requester.created_at AS requester_created_at,
        addressee.id AS addressee_id,
        addressee.login_id AS addressee_login_id,
        addressee.email AS addressee_email,
        addressee.name AS addressee_name,
        addressee.profile_image_url AS addressee_profile_image_url,
        addressee.role AS addressee_role,
        addressee.status AS addressee_account_status,
        addressee.created_at AS addressee_created_at
     FROM friendships f
     JOIN users requester ON requester.id = f.requester_user_id
     JOIN users addressee ON addressee.id = f.addressee_user_id
     WHERE f.requester_user_id = ?
        OR f.addressee_user_id = ?
     ORDER BY f.requested_at DESC, f.id DESC`,
    [currentUser.user.id, currentUser.user.id],
  );

  return {
    status: 200,
    body: {
      message: "친구 요청 목록입니다.",
      requests: rows.map(mapFriendRequest),
    },
  };
};

const createFriendRequest = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureFriendshipsTable();

  const targetLoginId = normalizeString(req.body.targetLoginId || req.body.loginId || req.body.friendLoginId).toLowerCase();
  let targetUserId = toPositiveInt(req.body.targetUserId || req.body.addresseeUserId || req.body.friendUserId);

  if (!targetUserId && !targetLoginId) {
    return { status: 400, body: { message: "친구 요청 대상 아이디가 필요합니다." } };
  }

  if (targetUserId === currentUser.user.id || targetLoginId === normalizeString(currentUser.user.login_id).toLowerCase()) {
    return { status: 400, body: { message: "자기 자신에게 친구 요청을 보낼 수 없습니다." } };
  }

  const connection = await pool.getConnection();
  try {
    let targetUser = null;
    if (targetUserId) {
      targetUser = await fetchUserById(connection, targetUserId);
    } else {
      const [targetRows] = await connection.query(
        `SELECT id, login_id, email, name, phone_number, profile_image_url, role, status, created_at, updated_at
         FROM users
         WHERE login_id = ?
         LIMIT 1`,
        [targetLoginId],
      );
      targetUser = targetRows[0] || null;
      targetUserId = toPositiveInt(targetUser?.id);
    }

    if (!targetUser) {
      return { status: 404, body: { message: "친구 요청 대상 사용자를 찾을 수 없습니다." } };
    }

    const existingFriendship = await findFriendshipBetweenUsers(connection, currentUser.user.id, targetUserId);
    if (existingFriendship) {
      if (existingFriendship.status === "accepted") {
        return { status: 409, body: { message: "이미 친구입니다." } };
      }
      if (existingFriendship.status === "pending") {
        return { status: 409, body: { message: "이미 처리 중인 친구 요청이 있습니다." } };
      }
      if (
        existingFriendship.status === "rejected" &&
        existingFriendship.requester_user_id === currentUser.user.id &&
        existingFriendship.addressee_user_id === targetUserId
      ) {
        await connection.query(
          `UPDATE friendships
           SET status = 'pending', requested_at = CURRENT_TIMESTAMP, responded_at = NULL
           WHERE id = ?`,
          [existingFriendship.id],
        );
      } else {
        await connection.query(
          `INSERT INTO friendships (requester_user_id, addressee_user_id, status, requested_at, responded_at)
           VALUES (?, ?, 'pending', CURRENT_TIMESTAMP, NULL)
           ON DUPLICATE KEY UPDATE
             status = VALUES(status),
             requested_at = VALUES(requested_at),
             responded_at = VALUES(responded_at)`,
          [currentUser.user.id, targetUserId],
        );
      }
    } else {
      await connection.query(
        `INSERT INTO friendships (requester_user_id, addressee_user_id, status, requested_at, responded_at)
         VALUES (?, ?, 'pending', CURRENT_TIMESTAMP, NULL)`,
        [currentUser.user.id, targetUserId],
      );
    }

    const [rows] = await connection.query(
      `SELECT
          f.id,
          f.requester_user_id,
          f.addressee_user_id,
          f.status AS friendship_status,
          f.requested_at,
          f.responded_at,
          requester.id AS requester_id,
          requester.login_id AS requester_login_id,
          requester.email AS requester_email,
          requester.name AS requester_name,
          requester.profile_image_url AS requester_profile_image_url,
          requester.role AS requester_role,
          requester.status AS requester_account_status,
          requester.created_at AS requester_created_at,
          addressee.id AS addressee_id,
          addressee.login_id AS addressee_login_id,
          addressee.email AS addressee_email,
          addressee.name AS addressee_name,
          addressee.profile_image_url AS addressee_profile_image_url,
          addressee.role AS addressee_role,
          addressee.status AS addressee_account_status,
          addressee.created_at AS addressee_created_at
       FROM friendships f
       JOIN users requester ON requester.id = f.requester_user_id
       JOIN users addressee ON addressee.id = f.addressee_user_id
       WHERE f.requester_user_id = ? AND f.addressee_user_id = ?
       LIMIT 1`,
      [currentUser.user.id, targetUserId],
    );

    await createUserNotification({
      userId: targetUserId,
      type: "friend-request",
      title: "새 친구 요청이 도착했어요",
      message: `${currentUser.user.name}님이 친구 요청을 보냈습니다.`,
      linkUrl: "/friends",
      payload: {
        requesterUserId: currentUser.user.id,
        requesterLoginId: currentUser.user.login_id,
      },
    });

    return {
      status: 201,
      body: {
        message: "친구 요청을 보냈습니다.",
        request: mapFriendRequest(rows[0]),
      },
    };
  } finally {
    connection.release();
  }
};

const respondToFriendRequest = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureFriendshipsTable();

  const requestId = toPositiveInt(req.params.requestId);
  const status = ["accepted", "rejected"].includes(req.body.status) ? req.body.status : null;

  if (!requestId || !status) {
    return { status: 400, body: { message: "유효한 요청 ID와 응답 상태가 필요합니다." } };
  }

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT *
       FROM friendships
       WHERE id = ?
       LIMIT 1`,
      [requestId],
    );

    const friendship = rows[0];
    if (!friendship) {
      return { status: 404, body: { message: "친구 요청을 찾을 수 없습니다." } };
    }
    if (friendship.addressee_user_id !== currentUser.user.id) {
      return { status: 403, body: { message: "해당 친구 요청에 응답할 권한이 없습니다." } };
    }
    if (friendship.status !== "pending") {
      return { status: 409, body: { message: "이미 처리된 친구 요청입니다." } };
    }

    await connection.query(
      `UPDATE friendships
       SET status = ?, responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, requestId],
    );

    const [updatedRows] = await connection.query(
      `SELECT
          f.id,
          f.requester_user_id,
          f.addressee_user_id,
          f.status AS friendship_status,
          f.requested_at,
          f.responded_at,
          requester.id AS requester_id,
          requester.login_id AS requester_login_id,
          requester.email AS requester_email,
          requester.name AS requester_name,
          requester.profile_image_url AS requester_profile_image_url,
          requester.role AS requester_role,
          requester.status AS requester_account_status,
          requester.created_at AS requester_created_at,
          addressee.id AS addressee_id,
          addressee.login_id AS addressee_login_id,
          addressee.email AS addressee_email,
          addressee.name AS addressee_name,
          addressee.profile_image_url AS addressee_profile_image_url,
          addressee.role AS addressee_role,
          addressee.status AS addressee_account_status,
          addressee.created_at AS addressee_created_at
       FROM friendships f
       JOIN users requester ON requester.id = f.requester_user_id
       JOIN users addressee ON addressee.id = f.addressee_user_id
       WHERE f.id = ?
       LIMIT 1`,
      [requestId],
    );

    if (status === "accepted") {
      await createUserNotification({
        userId: friendship.requester_user_id,
        type: "friend-accepted",
        title: "친구 요청이 수락되었어요",
        message: `${currentUser.user.name}님이 친구 요청을 수락했습니다.`,
        linkUrl: "/friends",
        payload: {
          addresseeUserId: currentUser.user.id,
          addresseeLoginId: currentUser.user.login_id,
        },
      });
    }

    return {
      status: 200,
      body: {
        message: status === "accepted" ? "친구 요청을 수락했습니다." : "친구 요청을 거절했습니다.",
        request: mapFriendRequest(updatedRows[0]),
      },
    };
  } finally {
    connection.release();
  }
};

const removeFriend = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureFriendshipsTable();

  const friendUserId = toPositiveInt(req.params.friendUserId || req.params.userId || req.params.id);
  if (!friendUserId) {
    return { status: 400, body: { message: "삭제할 친구 사용자 ID가 필요합니다." } };
  }

  const [result] = await pool.query(
    `DELETE FROM friendships
     WHERE status = 'accepted'
       AND (
         (requester_user_id = ? AND addressee_user_id = ?)
         OR
         (requester_user_id = ? AND addressee_user_id = ?)
       )`,
    [currentUser.user.id, friendUserId, friendUserId, currentUser.user.id],
  );

  if (Number(result.affectedRows || 0) === 0) {
    return { status: 404, body: { message: "삭제할 친구 관계를 찾지 못했습니다." } };
  }

  return {
    status: 200,
    body: {
      message: "친구가 목록에서 삭제되었습니다.",
    },
  };
};

const getMyProfile = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const statsRow = await getUserStudyStatsByUserId(currentUser.user.id);

  return {
    status: 200,
    body: {
      message: "내 프로필을 조회했습니다.",
      user: mapAppUser(currentUser.user),
      stats: statsRow
        ? {
            totalStudyMinutes: statsRow.total_study_minutes,
            totalAttendanceCount: statsRow.total_attendance_count,
            totalAbsenceCount: statsRow.total_absence_count,
            currentStreakDays: statsRow.current_streak_days,
            participationScore: Number(statsRow.participation_score),
            updatedAt: statsRow.updated_at,
          }
        : null,
    },
  };
};

const updateMyProfile = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const name = normalizeString(req.body.name);
  const email = normalizeString(req.body.email).toLowerCase();

  if (!name || !email) {
    return { status: 400, body: { message: "이름과 이메일을 모두 입력해주세요." } };
  }

  if (!validateName(name) || !validateEmail(email)) {
    return {
      status: 400,
      body: {
        message: "이름(2~100자)과 올바른 이메일 형식을 입력해주세요.",
      },
    };
  }

  const connection = await pool.getConnection();
  try {
    const [duplicateRows] = await connection.query(APP_QUERIES.SELECT_DUPLICATE_EMAIL_EXCLUDING_USER, [
      email,
      currentUser.user.id,
    ]);

    if (duplicateRows.length > 0) {
      return { status: 409, body: { message: "이미 사용 중인 이메일입니다." } };
    }

    await connection.query(APP_QUERIES.UPDATE_USER_PROFILE_BY_ID, [name, email, currentUser.user.id]);
    const updatedUser = await fetchUserById(connection, currentUser.user.id);
    if (!updatedUser) {
      return { status: 500, body: { message: "프로필 수정 후 사용자 조회에 실패했습니다." } };
    }

    return {
      status: 200,
      body: {
        message: "프로필이 수정되었습니다.",
        user: mapAppUser(updatedUser),
      },
    };
  } finally {
    connection.release();
  }
};

const updateMyProfileImage = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!req.file) {
    return { status: 400, body: { message: "업로드할 프로필 이미지를 선택해주세요." } };
  }

  let uploaded = null;
  try {
    uploaded = await uploadProfileImage(req.file);
  } catch (error) {
    if (error && error.code === "MINIO_NOT_CONFIGURED") {
      return {
        status: 503,
        body: {
          message: "이미지 저장소(MinIO) 설정이 되어있지 않아 프로필 업로드를 처리할 수 없습니다.",
        },
      };
    }

    return { status: 500, body: { message: "프로필 이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요." } };
  }

  const previousObjectName = resolveProfileImageObjectName(currentUser.user.profile_image_url);

  const connection = await pool.getConnection();
  try {
    await connection.query(APP_QUERIES.UPDATE_USER_PROFILE_IMAGE_BY_ID, [uploaded.publicUrl, currentUser.user.id]);
    const updatedUser = await fetchUserById(connection, currentUser.user.id);
    if (!updatedUser) {
      throw new Error("프로필 이미지 수정 후 사용자 조회에 실패했습니다.");
    }

    if (previousObjectName && previousObjectName !== uploaded.objectName) {
      await removeProfileImage(previousObjectName);
    }

    return {
      status: 200,
      body: {
        message: "프로필 이미지가 수정되었습니다.",
        user: mapAppUser(updatedUser),
      },
    };
  } catch (error) {
    if (uploaded?.objectName) {
      await removeProfileImage(uploaded.objectName);
    }

    const message = error instanceof Error ? error.message : "프로필 이미지 처리 중 오류가 발생했습니다.";
    return {
      status: 500,
      body: {
        message,
      },
    };
  } finally {
    connection.release();
  }
};

const updateMyPassword = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
  const newPasswordConfirm =
    typeof req.body.newPasswordConfirm === "string" ? req.body.newPasswordConfirm : "";

  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    return {
      status: 400,
      body: { message: "현재 비밀번호, 새 비밀번호, 새 비밀번호 확인을 모두 입력해주세요." },
    };
  }

  if (!validatePassword(newPassword)) {
    return {
      status: 400,
      body: {
        message:
          "새 비밀번호 형식이 올바르지 않습니다. (8~72자, 영문/숫자/특수문자 각각 1개 이상)",
      },
    };
  }

  if (newPassword !== newPasswordConfirm) {
    return {
      status: 400,
      body: { message: "새 비밀번호 확인이 일치하지 않습니다." },
    };
  }

  const [rows] = await pool.query(APP_QUERIES.SELECT_USER_PASSWORD_HASH_BY_ID, [currentUser.user.id]);
  if (rows.length === 0) {
    return {
      status: 404,
      body: { message: "사용자 비밀번호 정보를 찾을 수 없습니다." },
    };
  }

  const storedHash = rows[0].password_hash;
  const isValidCurrentPassword = await verifyPassword(currentPassword, storedHash);
  if (!isValidCurrentPassword) {
    return {
      status: 401,
      body: { message: "현재 비밀번호가 올바르지 않습니다." },
    };
  }

  const isSamePassword = await verifyPassword(newPassword, storedHash);
  if (isSamePassword) {
    return {
      status: 400,
      body: { message: "새 비밀번호는 현재 비밀번호와 다르게 설정해주세요." },
    };
  }

  const nextPasswordHash = await hashPassword(newPassword);
  await pool.query(APP_QUERIES.UPDATE_USER_PASSWORD_HASH_BY_ID, [nextPasswordHash, currentUser.user.id]);

  return {
    status: 200,
    body: { message: "비밀번호가 변경되었습니다." },
  };
};

const getStudyRoomContext = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  await ensureAcademiesSchema();
  await ensureStudyGroupsAcademySchema();
  await ensureTenantAcademiesSchemaByUserId(currentUser.user.id);

  const userAcademies = await listUserAcademiesFromTenant(currentUser.user.id);
  const academyIds = toUserAcademyIds(userAcademies);

  const [memberGroupRows] = await pool.query(APP_QUERIES.SELECT_MY_STUDY_GROUPS, [
    currentUser.user.id,
    currentUser.user.id,
    currentUser.user.id,
  ]);

  let visibleGroupRows = [...memberGroupRows];

  if (academyIds.length > 0) {
    const placeholders = academyIds.map(() => "?").join(", ");
    const [academyGroupRows] = await pool.query(
      `SELECT sg.id,
              sg.name,
              sg.subject,
              sg.description,
              sg.created_by,
              sg.max_members,
              sg.is_active,
              sg.created_at,
              sg.updated_at,
              sg.academy_id,
              academy.name AS academy_name,
              COALESCE(member_stats.member_count, 0) AS member_count,
              NULL AS my_role,
              leader_stats.leader_name
       FROM study_groups sg
       LEFT JOIN academies academy ON academy.id = sg.academy_id
       LEFT JOIN (
         SELECT study_group_id, COUNT(*) AS member_count
         FROM study_group_members
         GROUP BY study_group_id
       ) member_stats ON member_stats.study_group_id = sg.id
       LEFT JOIN (
         SELECT sgm.study_group_id, MAX(u.name) AS leader_name
         FROM study_group_members sgm
         JOIN users u ON u.id = sgm.user_id
         WHERE sgm.member_role = 'leader'
         GROUP BY sgm.study_group_id
       ) leader_stats ON leader_stats.study_group_id = sg.id
       WHERE sg.academy_id IN (${placeholders})
       ORDER BY sg.created_at DESC, sg.id DESC`,
      academyIds,
    );

    const mergedById = new Map();
    academyGroupRows.forEach((row) => {
      mergedById.set(Number(row.id), row);
    });
    memberGroupRows.forEach((row) => {
      mergedById.set(Number(row.id), row);
    });
    visibleGroupRows = Array.from(mergedById.values());
  }

  return {
    status: 200,
    body: {
      message: "스터디룸 정보입니다.",
      academies: userAcademies,
      studies: visibleGroupRows.map(mapStudyGroup),
    },
  };
};

const searchAcademies = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureAcademiesSchema();

  const q = normalizeString(req.query.q);
  const keyword = q ? q.slice(0, 60) : "";
  const [rows] = keyword
    ? await pool.query(APP_QUERIES.SELECT_ACADEMIES_BY_QUERY, [keyword])
    : await pool.query(APP_QUERIES.SELECT_ACADEMIES_DEFAULT_LIST);

  return {
    status: 200,
    body: {
      message: "학원 검색 결과입니다.",
      academies: rows.map(mapAcademy),
    },
  };
};

const registerMyAcademy = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureAcademiesSchema();
  await ensureTenantAcademiesSchemaByUserId(currentUser.user.id);

  const academyId = toPositiveInt(req.body.academyId);
  const verificationCode = normalizeVerificationCode(req.body.verificationCode);

  if (!academyId) {
    return { status: 400, body: { message: "유효한 academyId가 필요합니다." } };
  }
  if (!verificationCode) {
    return { status: 400, body: { message: "학원 인증번호를 입력해주세요." } };
  }

  const [academyRows] = await pool.query(APP_QUERIES.SELECT_ACADEMY_BY_ID_WITH_REGISTRATION_CODE, [academyId]);
  if (academyRows.length === 0) {
    return { status: 404, body: { message: "선택한 학원을 찾을 수 없습니다." } };
  }

  const academy = academyRows[0];
  const expectedCode = normalizeVerificationCode(academy.registration_code);
  if (verificationCode !== expectedCode) {
    return { status: 400, body: { message: "인증번호가 올바르지 않습니다." } };
  }

  const { pool: tenantPool } = await getTenantPool(currentUser.user.id);
  const [insertResult] = await tenantPool.query(`INSERT IGNORE INTO user_academies (academy_id) VALUES (?)`, [
    academyId,
  ]);
  if (Number(insertResult.affectedRows || 0) === 0) {
    return { status: 409, body: { message: "이미 등록한 학원입니다." } };
  }

  const myAcademies = await listUserAcademiesFromTenant(currentUser.user.id);

  return {
    status: 200,
    body: {
      message: "학원 추가가 완료되었습니다.",
      academies: myAcademies,
    },
  };
};

const listStudyRecruitments = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  const { academyIds } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIds.length === 0) {
    return {
      status: 200,
      body: {
        message: "등록한 학원이 없어 확인 가능한 스터디 모집이 없습니다.",
        recruitments: [],
      },
    };
  }

  const statusFilter = normalizeRecruitmentStatus(normalizeString(req.query.status));
  const keyword = normalizeString(req.query.q).slice(0, 80);

  const whereClauses = [`r.academy_id IN (${academyIds.map(() => "?").join(", ")})`];
  const params = [...academyIds];

  if (statusFilter) {
    whereClauses.push(`r.status = ?`);
    params.push(statusFilter);
  }

  if (keyword) {
    whereClauses.push(
      `(r.title LIKE CONCAT('%', ?, '%')
        OR r.target_class LIKE CONCAT('%', ?, '%')
        OR r.review_scope LIKE CONCAT('%', ?, '%')
        OR a.name LIKE CONCAT('%', ?, '%'))`,
    );
    params.push(keyword, keyword, keyword, keyword);
  }

  const [rows] = await pool.query(
    `${APP_QUERIES.SELECT_STUDY_RECRUITMENTS_BASE}
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY r.recruitment_end_at ASC, r.id ASC`,
    params,
  );
  const recruitments = rows.map(toRecruitmentResponse);

  return {
    status: 200,
    body: {
      message: "스터디 모집 목록입니다.",
      recruitments,
    },
  };
};

const getStudyRecruitmentById = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  await ensureStudyGroupsAcademySchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const [[recruitmentRow], [countRows], [myApplicationRows]] = await Promise.all([
    pool.query(APP_QUERIES.SELECT_STUDY_RECRUITMENT_BY_ID, [recruitmentId]),
    pool.query(APP_QUERIES.SELECT_RECRUITMENT_TOTAL_JOIN_APPLICANTS, [recruitmentId]),
    pool.query(APP_QUERIES.SELECT_MY_STUDY_RECRUITMENT_APPLICATION, [recruitmentId, currentUser.user.id]),
  ]);

  if (!recruitmentRow || recruitmentRow.length === 0) {
    return { status: 404, body: { message: "스터디 모집 정보를 찾을 수 없습니다." } };
  }

  const recruitment = toRecruitmentResponse(recruitmentRow[0]);
  if (!isRecruitmentVisibleToAcademySet(recruitment, academyIdSet)) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const totalApplicants = Number(countRows?.[0]?.count || 0);
  const myApplication = myApplicationRows?.[0] ? toRecruitmentApplicationResponse(myApplicationRows[0]) : null;

  return {
    status: 200,
    body: {
      message: "스터디 모집 상세 정보입니다.",
      recruitment,
      totalApplicants,
      myApplication,
      permission: {
        canRunMatching: isOperatorUser(currentUser.user),
      },
    },
  };
};

const getStudyRecruitmentApplicants = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!isOperatorUser(currentUser.user)) {
    return { status: 403, body: { message: "운영자 권한이 필요합니다." } };
  }

  await ensureStudyRecruitmentSchema();
  await ensureStudyGroupsAcademySchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const [recruitmentRows] = await pool.query(APP_QUERIES.SELECT_STUDY_RECRUITMENT_BY_ID, [recruitmentId]);
  if (recruitmentRows.length === 0) {
    return { status: 404, body: { message: "스터디 모집 정보를 찾을 수 없습니다." } };
  }

  const recruitment = toRecruitmentResponse(recruitmentRows[0]);
  if (!isRecruitmentVisibleToAcademySet(recruitment, academyIdSet)) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const [[countRows], [applicantRows], matchingSnapshot] = await Promise.all([
    pool.query(APP_QUERIES.SELECT_RECRUITMENT_TOTAL_JOIN_APPLICANTS, [recruitmentId]),
    pool.query(APP_QUERIES.SELECT_RECRUITMENT_APPLICANTS_FOR_MATCHING, [recruitmentId]),
    loadRecruitmentMatchingSnapshot(pool, recruitmentId),
  ]);

  const applicants = applicantRows.map((row) =>
    toRecruitmentApplicantResponse(
      row,
      matchingSnapshot.teamAssignmentByUserId,
      matchingSnapshot.waitlistOrderByUserId,
    ),
  );
  const latestBatch = matchingSnapshot.latestBatch;

  return {
    status: 200,
    body: {
      message: "신청자 관리 정보입니다.",
      recruitment,
      totalApplicants: Number(countRows?.[0]?.count || 0),
      applicants,
      matchingSummary: {
        completed: Boolean(latestBatch),
        batchId: latestBatch ? Number(latestBatch.id) : null,
        assignedApplicants: Number(latestBatch?.assigned_applicants || 0),
        waitlistedApplicants: Number(latestBatch?.waitlisted_applicants || 0),
        teamSize: Math.max(2, Number(recruitment.teamSize || 4)),
      },
    },
  };
};

const getMyStudyRecruitmentApplication = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const [[recruitmentRows], [applicationRows]] = await Promise.all([
    pool.query(APP_QUERIES.SELECT_STUDY_RECRUITMENT_BY_ID, [recruitmentId]),
    pool.query(APP_QUERIES.SELECT_MY_STUDY_RECRUITMENT_APPLICATION, [recruitmentId, currentUser.user.id]),
  ]);

  if (!recruitmentRows || recruitmentRows.length === 0) {
    return { status: 404, body: { message: "스터디 모집 정보를 찾을 수 없습니다." } };
  }

  const recruitment = toRecruitmentResponse(recruitmentRows[0]);
  if (!isRecruitmentVisibleToAcademySet(recruitment, academyIdSet)) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  return {
    status: 200,
    body: {
      message: "내 신청 정보입니다.",
      application: applicationRows[0] ? toRecruitmentApplicationResponse(applicationRows[0]) : null,
    },
  };
};

const upsertMyStudyRecruitmentApplication = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const [recruitmentRows] = await pool.query(APP_QUERIES.SELECT_STUDY_RECRUITMENT_BY_ID, [recruitmentId]);
  if (recruitmentRows.length === 0) {
    return { status: 404, body: { message: "스터디 모집 정보를 찾을 수 없습니다." } };
  }

  const recruitment = toRecruitmentResponse(recruitmentRows[0]);
  if (!isRecruitmentVisibleToAcademySet(recruitment, academyIdSet)) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  if (recruitment.status !== "open") {
    return { status: 409, body: { message: "모집이 마감되어 신청 정보를 수정할 수 없습니다." } };
  }

  const participationIntent = normalizeParticipationIntent(normalizeString(req.body.participationIntent || "join"));
  const availableTimeSlots = Array.isArray(req.body.availableTimeSlots) ? req.body.availableTimeSlots : [];
  const preferredStyle = normalizeNullableString(req.body.preferredStyle)?.slice(0, 120) || null;
  const mbtiRaw = normalizeString(req.body.mbtiType).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const mbtiType = mbtiRaw.length === 4 ? mbtiRaw : null;
  const customResponses = parseJsonObjectText(req.body.customResponses);
  const presentationLevel = normalizePresentationLevel(normalizeString(req.body.presentationLevel || "normal"));
  const normalizedAvailableTimeSlots = parseJsonArrayText(availableTimeSlots);

  await pool.query(APP_QUERIES.UPSERT_STUDY_RECRUITMENT_APPLICATION, [
    recruitmentId,
    currentUser.user.id,
    participationIntent,
    stringifyJsonArray(normalizedAvailableTimeSlots, 20, 40),
    preferredStyle,
    mbtiType,
    stringifyJsonObject(customResponses, 20, 120),
    presentationLevel,
  ]);

  const [rows] = await pool.query(APP_QUERIES.SELECT_MY_STUDY_RECRUITMENT_APPLICATION, [
    recruitmentId,
    currentUser.user.id,
  ]);

  return {
    status: 200,
    body: {
      message: "신청 정보가 저장되었습니다.",
      application: toRecruitmentApplicationResponse(rows[0]),
    },
  };
};

const runStudyRecruitmentMatching = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!isOperatorUser(currentUser.user)) {
    return { status: 403, body: { message: "운영자 권한이 필요합니다." } };
  }

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const matchingContext = await loadMatchingReadyRecruitment(connection, recruitmentId, academyIdSet);
    if (matchingContext.error) {
      await connection.rollback();
      return matchingContext.error;
    }

    const recruitment = matchingContext.recruitment;
    const applicantRows = matchingContext.applicantRows;
    if (applicantRows.length === 0) {
      await connection.rollback();
      return { status: 409, body: { message: "참여 신청자가 없어 매칭을 실행할 수 없습니다." } };
    }

    const teamSize = Math.max(2, Math.min(8, Number(recruitment.teamSize || 4)));
    const seed = randomUUID().replace(/-/g, "");
    const shuffledApplicants = shuffleWithSeed(applicantRows, seed);
    const fullTeamCount = Math.floor(shuffledApplicants.length / teamSize);
    const teams = [];
    for (let index = 0; index < fullTeamCount; index += 1) {
      const startIndex = index * teamSize;
      teams.push({
        teamNumber: index + 1,
        members: shuffledApplicants.slice(startIndex, startIndex + teamSize),
      });
    }
    const waitlist = shuffledApplicants.slice(fullTeamCount * teamSize);

    const matchingResult = await executeRecruitmentMatchingPlan({
      connection,
      recruitmentId,
      recruitment,
      currentUserId: currentUser.user.id,
      teamSize,
      teams,
      waitlist,
      matchingSeed: seed,
    });

    await connection.commit();

    return {
      status: 200,
      body: {
        message: "랜덤 매칭이 완료되었습니다.",
        result: {
          recruitmentId,
          ...matchingResult,
          strategy: "random",
        },
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const previewStudyRecruitmentAiMatching = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!isOperatorUser(currentUser.user)) {
    return { status: 403, body: { message: "운영자 권한이 필요합니다." } };
  }

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const matchingContext = await loadMatchingReadyRecruitment(pool, recruitmentId, academyIdSet);
  if (matchingContext.error) return matchingContext.error;

  const recruitment = matchingContext.recruitment;
  const applicantRows = matchingContext.applicantRows;
  if (applicantRows.length === 0) {
    return { status: 409, body: { message: "참여 신청자가 없어 AI 배정안을 만들 수 없습니다." } };
  }

  const teamSize = Math.max(2, Math.min(8, Number(recruitment.teamSize || 4)));
  const aiPlan = await generateAiMatchingPlanByGemini({
    recruitment,
    applicantRows,
    teamSize,
  });
  const assignments = toMatchingAssignments(aiPlan.teams);
  const waitlistApplicationIds = aiPlan.waitlist
    .map((applicant) => toPositiveInt(applicant?.id))
    .filter(Boolean);
  console.info(
    `[matching:ai-preview] recruitment=${recruitmentId} strategy=${
      aiPlan.source === "gemini_cli" ? "ai_gemini_cli" : "ai_fallback"
    } teams=${aiPlan.teams.length} assigned=${assignments.length} waitlist=${waitlistApplicationIds.length} generatedBy=${
      aiPlan.generatedBy || "unknown"
    } warning=${aiPlan.warning ? JSON.stringify(aiPlan.warning) : "none"}`,
  );
  const teamLog = aiPlan.teams.map((team) => ({
    teamNumber: Number(team?.teamNumber || 0),
    members: (Array.isArray(team?.members) ? team.members : []).map((member) => ({
      applicationId: toPositiveInt(member?.id),
      userId: toPositiveInt(member?.user_id),
      name: normalizeString(member?.user_name) || null,
      loginId: normalizeString(member?.login_id) || null,
      mbti: normalizeString(member?.mbti_type).toUpperCase() || null,
    })),
  }));
  console.info(`[matching:ai-preview:teams] recruitment=${recruitmentId} ${JSON.stringify(teamLog)}`);

  return {
    status: 200,
    body: {
      message: "AI 배정안을 만들었습니다. 하단의 팀 확정하기를 눌러야 스터디가 생성됩니다.",
      preview: {
        recruitmentId,
        strategy: aiPlan.source === "gemini_cli" ? "ai_gemini_cli" : "ai_fallback",
        teamSize,
        totalApplicants: applicantRows.length,
        assignedApplicants: assignments.length,
        waitlistedApplicants: waitlistApplicationIds.length,
        teams: aiPlan.teams.length,
        assignments,
        waitlistApplicationIds,
        warning: aiPlan.warning || null,
        generatedBy: aiPlan.generatedBy || null,
      },
    },
  };
};

const runStudyRecruitmentAiMatching = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!isOperatorUser(currentUser.user)) {
    return { status: 403, body: { message: "운영자 권한이 필요합니다." } };
  }

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const matchingContext = await loadMatchingReadyRecruitment(connection, recruitmentId, academyIdSet);
    if (matchingContext.error) {
      await connection.rollback();
      return matchingContext.error;
    }

    const recruitment = matchingContext.recruitment;
    const applicantRows = matchingContext.applicantRows;
    if (applicantRows.length === 0) {
      await connection.rollback();
      return { status: 409, body: { message: "참여 신청자가 없어 매칭을 실행할 수 없습니다." } };
    }

    const teamSize = Math.max(2, Math.min(8, Number(recruitment.teamSize || 4)));
    const aiPlan = await generateAiMatchingPlanByGemini({
      recruitment,
      applicantRows,
      teamSize,
    });
    const matchingResult = await executeRecruitmentMatchingPlan({
      connection,
      recruitmentId,
      recruitment,
      currentUserId: currentUser.user.id,
      teamSize,
      teams: aiPlan.teams,
      waitlist: aiPlan.waitlist,
      matchingSeed:
        aiPlan.source === "gemini_cli"
          ? `ai-gemini-${randomUUID().replace(/-/g, "")}`
          : `ai-fallback-${randomUUID().replace(/-/g, "")}`,
    });

    await connection.commit();

    return {
      status: 200,
      body: {
        message:
          aiPlan.source === "gemini_cli" ? "AI 신청 체크 기준 매칭이 완료되었습니다." : "AI 매칭이 완료되었습니다. (기본 로직 사용)",
        result: {
          recruitmentId,
          ...matchingResult,
          strategy: aiPlan.source === "gemini_cli" ? "ai_gemini_cli" : "ai_fallback",
          warning: aiPlan.warning || null,
          generatedBy: aiPlan.generatedBy || null,
        },
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const runStudyRecruitmentManualMatching = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!isOperatorUser(currentUser.user)) {
    return { status: 403, body: { message: "운영자 권한이 필요합니다." } };
  }

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const matchingContext = await loadMatchingReadyRecruitment(connection, recruitmentId, academyIdSet);
    if (matchingContext.error) {
      await connection.rollback();
      return matchingContext.error;
    }

    const recruitment = matchingContext.recruitment;
    const applicantRows = matchingContext.applicantRows;
    if (applicantRows.length === 0) {
      await connection.rollback();
      return { status: 409, body: { message: "참여 신청자가 없어 매칭을 실행할 수 없습니다." } };
    }

    const requestedSource = normalizeString(req.body?.source).toLowerCase();
    const isAiDraftSource = requestedSource === "ai";
    const teamSize = Math.max(2, Math.min(8, Number(recruitment.teamSize || 4)));
    const teamNameByTeamNumber = normalizeMatchingTeamNameMap(req.body?.teamNames);
    const manualPlan = buildManualMatchingPlan(
      applicantRows,
      req.body?.assignments,
      teamSize,
      teamNameByTeamNumber,
    );
    if (manualPlan.error) {
      await connection.rollback();
      return manualPlan.error;
    }

    const matchingResult = await executeRecruitmentMatchingPlan({
      connection,
      recruitmentId,
      recruitment,
      currentUserId: currentUser.user.id,
      teamSize,
      teams: manualPlan.teams,
      waitlist: manualPlan.waitlist,
      matchingSeed: `${isAiDraftSource ? "ai-draft" : "manual"}-${randomUUID().replace(/-/g, "")}`,
    });

    await connection.commit();

    return {
      status: 200,
      body: {
        message: isAiDraftSource ? "AI 배정안 확정이 완료되었습니다." : "관리자 직접 매칭이 완료되었습니다.",
        result: {
          recruitmentId,
          ...matchingResult,
          strategy: isAiDraftSource ? "ai" : "manual",
        },
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getMyStudyRecruitmentResult = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  const { academyIdSet } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIdSet.size === 0) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "유효한 모집 ID가 필요합니다." } };
  }

  const [[recruitmentRows], [applicantCountRows], [batchRows], [myApplicationRows], [myTeamRows], [myWaitlistRows]] =
    await Promise.all([
      pool.query(APP_QUERIES.SELECT_STUDY_RECRUITMENT_BY_ID, [recruitmentId]),
      pool.query(APP_QUERIES.SELECT_RECRUITMENT_TOTAL_JOIN_APPLICANTS, [recruitmentId]),
      pool.query(APP_QUERIES.SELECT_RECRUITMENT_MATCHING_BATCH_SUMMARY, [recruitmentId]),
      pool.query(APP_QUERIES.SELECT_MY_STUDY_RECRUITMENT_APPLICATION, [recruitmentId, currentUser.user.id]),
      pool.query(APP_QUERIES.SELECT_MY_MATCH_TEAM_BY_RECRUITMENT, [recruitmentId, currentUser.user.id]),
      pool.query(APP_QUERIES.SELECT_MY_WAITLIST_INFO_BY_RECRUITMENT, [recruitmentId, currentUser.user.id]),
    ]);

  if (!recruitmentRows || recruitmentRows.length === 0) {
    return { status: 404, body: { message: "스터디 모집 정보를 찾을 수 없습니다." } };
  }

  const recruitment = toRecruitmentResponse(recruitmentRows[0]);
  if (!isRecruitmentVisibleToAcademySet(recruitment, academyIdSet)) {
    return FORBIDDEN_RECRUITMENT_ACCESS_ERROR;
  }

  const totalApplicants = Number(applicantCountRows?.[0]?.count || 0);
  const latestBatch = batchRows?.[0] || null;
  const myApplication = myApplicationRows?.[0] ? toRecruitmentApplicationResponse(myApplicationRows[0]) : null;
  const myTeam = myTeamRows?.[0] || null;
  const myWaitlist = myWaitlistRows?.[0] || null;

  let myStatus = "not_applied";
  if (myApplication?.participationIntent === "skip") {
    myStatus = "skipped";
  } else if (myTeam) {
    myStatus = "assigned";
  } else if (myWaitlist) {
    myStatus = "waitlisted";
  } else if (myApplication?.participationIntent === "join") {
    myStatus = latestBatch ? "unassigned" : "pending";
  }

  const teamMembers = [];
  if (myTeam?.team_id) {
    const [memberRows] = await pool.query(APP_QUERIES.SELECT_MATCH_TEAM_MEMBERS, [myTeam.team_id]);
    memberRows.forEach((member) => {
      teamMembers.push({
        userId: Number(member.user_id),
        name: member.name,
        loginId: member.login_id,
        role: member.role,
      });
    });
  }

  const assignedApplicants = Number(latestBatch?.assigned_applicants || 0);
  const waitlistedApplicants = Number(latestBatch?.waitlisted_applicants || 0);
  const teamSize = Math.max(2, Number(recruitment.teamSize || 4));

  return {
    status: 200,
    body: {
      message: "매칭 결과입니다.",
      recruitment,
      totalApplicants,
      assignmentCompleted: Boolean(latestBatch),
      assignedApplicants,
      waitlistedApplicants,
      assignedTeamsCount: Math.floor(assignedApplicants / teamSize),
      teamSize,
      myStatus,
      myTeam: myTeam
        ? {
            teamId: Number(myTeam.team_id),
            teamNumber: Number(myTeam.team_number),
            studyGroupId: Number(myTeam.study_group_id),
            firstMeetingAt: myTeam.first_meeting_at,
            firstMeetingLabel: myTeam.first_meeting_label || null,
            studyRoomPath: `/study-room/${myTeam.study_group_id}`,
            members: teamMembers,
          }
        : null,
      waitlist: myWaitlist
        ? {
            order: Number(myWaitlist.waitlist_order),
          }
        : null,
    },
  };
};

const listStudyGroups = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  await ensureStudyGroupsAcademySchema();
  const [rows] = await pool.query(APP_QUERIES.SELECT_MY_STUDY_GROUPS, [
    currentUser.user.id,
    currentUser.user.id,
    currentUser.user.id,
  ]);

  return { status: 200, body: { message: "스터디 그룹 목록입니다.", groups: rows.map(mapStudyGroup) } };
};

const createStudyGroup = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyGroupsAcademySchema();

  const name = normalizeString(req.body.name);
  const subject = normalizeString(req.body.subject);
  const description = normalizeNullableString(req.body.description);
  const maxMembers = Math.max(2, Math.min(50, toNumberOrDefault(req.body.maxMembers, 6)));
  const requestedAcademyId = toPositiveInt(req.body.academyId);

  if (!name || !subject) {
    return { status: 400, body: { message: "그룹명과 과목을 입력해주세요." } };
  }

  const connection = await pool.getConnection();
  try {
    let academyId = null;
    if (isOperatorUser(currentUser.user)) {
      academyId = requestedAcademyId || (await getPrimaryAcademyIdForUser(currentUser.user.id));
    }

    await connection.beginTransaction();
    const [result] = await connection.query(APP_QUERIES.INSERT_STUDY_GROUP, [
      name,
      subject,
      description,
      currentUser.user.id,
      academyId,
      maxMembers,
    ]);

    await connection.query(APP_QUERIES.INSERT_STUDY_GROUP_LEADER, [result.insertId, currentUser.user.id]);

    await connection.commit();

    const [rows] = await connection.query(APP_QUERIES.SELECT_CREATED_STUDY_GROUP, [result.insertId]);
    return { status: 201, body: { message: "스터디 그룹이 생성되었습니다.", group: mapStudyGroup(rows[0]) } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const updateStudyGroup = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyGroupsAcademySchema();

  const groupId = toPositiveInt(req.params.groupId);
  const name = normalizeString(req.body.name);
  const subject = normalizeString(req.body.subject);
  const description = normalizeNullableString(req.body.description);
  const maxMembers = Math.max(2, Math.min(50, toNumberOrDefault(req.body.maxMembers, 6)));
  const isActive = req.body.isActive === undefined ? null : Number(Boolean(req.body.isActive));

  if (!groupId || !name || !subject) {
    return { status: 400, body: { message: "유효한 그룹과 수정 정보를 입력해주세요." } };
  }

  const [membershipRows] = await pool.query(APP_QUERIES.SELECT_STUDY_GROUP_MEMBERSHIP_ROLE, [
    groupId,
    currentUser.user.id,
  ]);

  if (membershipRows.length === 0 || membershipRows[0].member_role !== "leader") {
    return { status: 403, body: { message: "그룹 리더만 수정할 수 있습니다." } };
  }

  await pool.query(APP_QUERIES.UPDATE_STUDY_GROUP_BY_ID, [name, subject, description, maxMembers, isActive, groupId]);

  const [rows] = await pool.query(APP_QUERIES.SELECT_STUDY_GROUP_BY_ID_WITH_MEMBER_COUNT, [groupId]);
  return { status: 200, body: { message: "스터디 그룹이 수정되었습니다.", group: mapStudyGroup(rows[0]) } };
};

const joinStudyGroup = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const groupId = toPositiveInt(req.params.groupId);
  if (!groupId) return { status: 400, body: { message: "유효한 그룹 ID가 필요합니다." } };

  const connection = await pool.getConnection();
  try {
    const [groupRows] = await connection.query(APP_QUERIES.SELECT_JOINABLE_GROUP_BY_ID_WITH_MEMBER_COUNT, [groupId]);

    if (groupRows.length === 0) return { status: 404, body: { message: "스터디 그룹을 찾을 수 없습니다." } };
    if (!groupRows[0].is_active) return { status: 400, body: { message: "비활성화된 그룹입니다." } };
    if (Number(groupRows[0].member_count) >= groupRows[0].max_members) {
      return { status: 409, body: { message: "그룹 정원이 가득 찼습니다." } };
    }

    await connection.query(APP_QUERIES.INSERT_IGNORE_STUDY_GROUP_MEMBER, [groupId, currentUser.user.id]);
    return { status: 200, body: { message: "스터디 그룹에 참여했습니다." } };
  } finally {
    connection.release();
  }
};

const listStudySessions = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudySessionLearningSchema();

  let rows;
  if (isOperatorUser(currentUser.user)) {
    const { academyIds } = await getUserAcademyAccessContext(currentUser.user.id);
    if (academyIds.length > 0) {
      const placeholders = academyIds.map(() => "?").join(", ");
      const [academyRows] = await pool.query(
        `SELECT ss.*, sg.name AS group_name, sg.subject,
                COUNT(DISTINCT al.id) AS attendance_count,
                SUM(CASE WHEN al.attendance_status = 'present' THEN 1 ELSE 0 END) AS present_count,
                SUM(CASE WHEN al.attendance_status = 'late' THEN 1 ELSE 0 END) AS late_count,
                SUM(CASE WHEN al.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count
         FROM study_sessions ss
         JOIN study_groups sg ON sg.id = ss.study_group_id
         LEFT JOIN attendance_logs al ON al.study_session_id = ss.id
         WHERE sg.academy_id IN (${placeholders})
         GROUP BY ss.id
         ORDER BY COALESCE(ss.scheduled_start_at, ss.created_at) ASC, ss.id ASC`,
        academyIds,
      );
      rows = academyRows;
    } else {
      rows = [];
    }
  } else {
    const [userRows] = await pool.query(APP_QUERIES.SELECT_STUDY_SESSIONS_BY_USER_ID, [currentUser.user.id]);
    rows = userRows;
  }
  return { status: 200, body: { message: "스터디 세션 목록입니다.", sessions: rows.map(mapStudySession) } };
};

const syncSessionStudyTimeToAttendance = async ({ sessionId, userId, studyDurationMinutes, studyStartedAt, aiReviewedAt }) => {
  const normalizedSessionId = toPositiveInt(sessionId);
  const normalizedUserId = toPositiveInt(userId);
  if (!normalizedSessionId || !normalizedUserId) return;

  const normalizedMinutes = Math.max(0, toNumberOrDefault(studyDurationMinutes, 0));
  const checkedInAt = parseDateTime(studyStartedAt);
  const checkedOutAt = parseDateTime(aiReviewedAt);

  // 학습시간 집계는 세션 저장 데이터와 동일한 participation_minutes를 기준으로 통일한다.
  await pool.query(APP_QUERIES.UPSERT_STUDY_TIME_ATTENDANCE_LOG, [
    normalizedSessionId,
    normalizedUserId,
    checkedInAt,
    checkedOutAt || checkedInAt,
    normalizedMinutes,
  ]);

  await recomputeUserStats(normalizedUserId);
};

const createStudySession = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudySessionLearningSchema();

  const studyGroupId = toPositiveInt(req.body.studyGroupId);
  const topicTitle = normalizeString(req.body.topicTitle);
  const topicDescription = normalizeNullableString(req.body.topicDescription);
  const scheduledStartAt = req.body.scheduledStartAt ? parseDateTime(req.body.scheduledStartAt) : null;
  const status = SESSION_STATUSES.includes(req.body.status) ? req.body.status : "scheduled";
  const studyStartedAtInput = normalizeNullableString(req.body.studyStartedAt);
  const aiReviewedAtInput = normalizeNullableString(req.body.aiReviewedAt);
  const studyStartedAt = studyStartedAtInput ? parseDateTime(studyStartedAtInput) : null;
  const aiReviewedAt = aiReviewedAtInput ? parseDateTime(aiReviewedAtInput) : null;
  const hasStudyDurationInput =
    req.body.studyDurationMinutes !== undefined &&
    req.body.studyDurationMinutes !== null &&
    String(req.body.studyDurationMinutes).trim() !== "";
  const requestedStudyDurationMinutes = hasStudyDurationInput
    ? Math.max(0, toNumberOrDefault(req.body.studyDurationMinutes, 0))
    : null;
  const computedStudyDurationMinutes =
    studyStartedAt && aiReviewedAt
      ? Math.max(0, Math.floor((aiReviewedAt.getTime() - studyStartedAt.getTime()) / 60000))
      : null;
  const studyDurationMinutes =
    computedStudyDurationMinutes != null
      ? computedStudyDurationMinutes
      : requestedStudyDurationMinutes != null
        ? requestedStudyDurationMinutes
        : 0;

  if (
    !studyGroupId ||
    !topicTitle ||
    (req.body.scheduledStartAt && !scheduledStartAt) ||
    (studyStartedAtInput && !studyStartedAt) ||
    (aiReviewedAtInput && !aiReviewedAt)
  ) {
    return { status: 400, body: { message: "그룹, 주제, 일정 정보를 확인해주세요." } };
  }

  if (studyStartedAt && aiReviewedAt && aiReviewedAt.getTime() < studyStartedAt.getTime()) {
    return { status: 400, body: { message: "AI 검사 시각은 타이머 시작 시각보다 빠를 수 없습니다." } };
  }

  const [membershipRows] = await pool.query(APP_QUERIES.SELECT_STUDY_GROUP_MEMBERSHIP_ROLE, [
    studyGroupId,
    currentUser.user.id,
  ]);

  if (membershipRows.length === 0) {
    return { status: 403, body: { message: "해당 그룹 멤버만 세션을 생성할 수 있습니다." } };
  }

  const startedAt = status === "in_progress" ? new Date() : null;
  const endedAt = status === "completed" ? new Date() : null;

  const [result] = await pool.query(APP_QUERIES.INSERT_STUDY_SESSION, [
    studyGroupId,
    topicTitle,
    topicDescription,
    scheduledStartAt,
    startedAt,
    endedAt,
    status,
    currentUser.user.id,
    studyDurationMinutes,
    studyStartedAt,
    aiReviewedAt,
  ]);

  const [rows] = await pool.query(APP_QUERIES.SELECT_STUDY_SESSION_BY_ID, [result.insertId]);
  if (rows[0]) {
    const hasLearningData =
      Number(rows[0].study_duration_minutes || 0) > 0 || rows[0].study_started_at || rows[0].ai_reviewed_at;
    if (hasLearningData) {
      await syncSessionStudyTimeToAttendance({
        sessionId: rows[0].id,
        userId: currentUser.user.id,
        studyDurationMinutes: rows[0].study_duration_minutes,
        studyStartedAt: rows[0].study_started_at,
        aiReviewedAt: rows[0].ai_reviewed_at,
      });
    }
  }
  return { status: 201, body: { message: "스터디 세션이 생성되었습니다.", session: mapStudySession(rows[0]) } };
};

const updateStudySession = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudySessionLearningSchema();

  const sessionId = toPositiveInt(req.params.sessionId);
  const topicTitle = normalizeString(req.body.topicTitle);
  const topicDescription = normalizeNullableString(req.body.topicDescription);
  const scheduledStartAt = req.body.scheduledStartAt ? parseDateTime(req.body.scheduledStartAt) : null;
  const status = SESSION_STATUSES.includes(req.body.status) ? req.body.status : null;
  const studyStartedAtInput = normalizeNullableString(req.body.studyStartedAt);
  const aiReviewedAtInput = normalizeNullableString(req.body.aiReviewedAt);
  const studyStartedAt = studyStartedAtInput ? parseDateTime(studyStartedAtInput) : null;
  const aiReviewedAt = aiReviewedAtInput ? parseDateTime(aiReviewedAtInput) : null;
  const hasStudyDurationInput =
    req.body.studyDurationMinutes !== undefined &&
    req.body.studyDurationMinutes !== null &&
    String(req.body.studyDurationMinutes).trim() !== "";
  const requestedStudyDurationMinutes = hasStudyDurationInput
    ? Math.max(0, toNumberOrDefault(req.body.studyDurationMinutes, 0))
    : null;
  const computedStudyDurationMinutes =
    studyStartedAt && aiReviewedAt
      ? Math.max(0, Math.floor((aiReviewedAt.getTime() - studyStartedAt.getTime()) / 60000))
      : null;
  const nextStudyDurationMinutes =
    computedStudyDurationMinutes != null ? computedStudyDurationMinutes : requestedStudyDurationMinutes;

  if (
    !sessionId ||
    !topicTitle ||
    (req.body.scheduledStartAt && !scheduledStartAt) ||
    !status ||
    (studyStartedAtInput && !studyStartedAt) ||
    (aiReviewedAtInput && !aiReviewedAt)
  ) {
    return { status: 400, body: { message: "수정할 세션 정보가 올바르지 않습니다." } };
  }

  if (studyStartedAt && aiReviewedAt && aiReviewedAt.getTime() < studyStartedAt.getTime()) {
    return { status: 400, body: { message: "AI 검사 시각은 타이머 시작 시각보다 빠를 수 없습니다." } };
  }

  const [rows] = await pool.query(APP_QUERIES.SELECT_STUDY_SESSION_EDIT_PERMISSION, [sessionId, currentUser.user.id]);
  if (rows.length === 0) return { status: 403, body: { message: "해당 세션을 수정할 권한이 없습니다." } };

  const [sessionDetailRows] = await pool.query(APP_QUERIES.SELECT_STUDY_SESSION_BY_ID, [sessionId]);
  if (sessionDetailRows.length === 0) {
    return { status: 404, body: { message: "스터디 세션을 찾을 수 없습니다." } };
  }

  const targetSession = sessionDetailRows[0];
  const referenceDate = targetSession.scheduled_start_at || targetSession.created_at;
  if (isPastDateInKst(referenceDate) && hasPersistedStudyContent(targetSession.topic_description)) {
    return { status: 403, body: { message: "지난 날짜에 저장된 스터디 기록은 수정할 수 없습니다." } };
  }

  await pool.query(APP_QUERIES.UPDATE_STUDY_SESSION_BY_ID, [
    topicTitle,
    topicDescription,
    scheduledStartAt,
    status,
    status,
    status,
    status,
    nextStudyDurationMinutes,
    nextStudyDurationMinutes,
    studyStartedAt,
    studyStartedAt,
    aiReviewedAt,
    aiReviewedAt,
    sessionId,
  ]);

  const [sessionRows] = await pool.query(APP_QUERIES.SELECT_STUDY_SESSION_WITH_ATTENDANCE_BY_ID, [sessionId]);
  if (sessionRows[0]) {
    const hasLearningData =
      Number(sessionRows[0].study_duration_minutes || 0) > 0 ||
      sessionRows[0].study_started_at ||
      sessionRows[0].ai_reviewed_at;
    if (hasLearningData) {
      await syncSessionStudyTimeToAttendance({
        sessionId: sessionRows[0].id,
        userId: currentUser.user.id,
        studyDurationMinutes: sessionRows[0].study_duration_minutes,
        studyStartedAt: sessionRows[0].study_started_at,
        aiReviewedAt: sessionRows[0].ai_reviewed_at,
      });
    }
  }
  return { status: 200, body: { message: "스터디 세션이 수정되었습니다.", session: mapStudySession(sessionRows[0]) } };
};

const uploadStudySessionContentImage = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  if (!req.file) {
    return { status: 400, body: { message: "업로드할 본문 이미지 파일이 필요합니다." } };
  }

  let uploaded = null;
  try {
    uploaded = await uploadProfileImage(req.file);
  } catch (error) {
    if (error && error.code === "MINIO_NOT_CONFIGURED") {
      return {
        status: 503,
        body: { message: "이미지 저장소(MinIO) 설정이 되어있지 않아 본문 이미지 업로드를 처리할 수 없습니다." },
      };
    }
    throw error;
  }

  return {
    status: 201,
    body: {
      message: "본문 이미지가 업로드되었습니다.",
      imageUrl: uploaded.publicUrl,
    },
  };
};

const listAttendance = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const studySessionId = toPositiveInt(req.query.studySessionId);
  const params = studySessionId
    ? [currentUser.user.id, studySessionId, currentUser.user.id, studySessionId]
    : [currentUser.user.id, currentUser.user.id];

  const [rows] = await pool.query(buildListAttendanceQuery(Boolean(studySessionId)), params);
  return { status: 200, body: { message: "출석 현황입니다.", attendance: rows.map(mapAttendance) } };
};

const upsertAttendance = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const studySessionId = toPositiveInt(req.body.studySessionId);
  const targetUserId = toPositiveInt(req.body.targetUserId || currentUser.user.id);
  const attendanceStatus = ATTENDANCE_STATUSES.includes(req.body.attendanceStatus) ? req.body.attendanceStatus : null;
  const participationMinutes = Math.max(0, toNumberOrDefault(req.body.participationMinutes, 0));

  if (!studySessionId || !targetUserId || !attendanceStatus) {
    return { status: 400, body: { message: "세션, 사용자, 출석 상태를 확인해주세요." } };
  }

  const [membershipRows] = await pool.query(APP_QUERIES.SELECT_STUDY_SESSION_MEMBERSHIP_FOR_ATTENDANCE, [
    studySessionId,
    currentUser.user.id,
  ]);

  if (membershipRows.length === 0) {
    return { status: 403, body: { message: "해당 세션의 그룹 멤버만 출석을 기록할 수 있습니다." } };
  }

  const checkedInAt = attendanceStatus === "absent" ? null : new Date();
  const checkedOutAt = attendanceStatus === "absent" ? null : new Date();

  await pool.query(APP_QUERIES.UPSERT_ATTENDANCE_LOG, [
    studySessionId,
    targetUserId,
    attendanceStatus,
    checkedInAt,
    checkedOutAt,
    participationMinutes,
  ]);

  await recomputeUserStats(targetUserId);

  const [rows] = await pool.query(APP_QUERIES.SELECT_ATTENDANCE_BY_SESSION_AND_USER, [studySessionId, targetUserId]);
  return { status: 200, body: { message: "출석 정보가 저장되었습니다.", attendance: mapAttendance(rows[0]) } };
};

const recomputeUserStats = async (userId) => {
  const [rows] = await pool.query(APP_QUERIES.SELECT_ATTENDANCE_STATS_BY_USER_ID, [userId]);
  const stats = rows[0] || {};

  const normalizedStats = {
    totalStudyMinutes: Number(stats.total_study_minutes || 0),
    totalAttendanceCount: Number(stats.total_attendance_count || 0),
    totalAbsenceCount: Number(stats.total_absence_count || 0),
    currentStreakDays: Number(stats.total_attendance_count || 0),
    participationScore: Number(stats.participation_score || 0),
  };

  await upsertTenantStudyStatsByUserId(userId, normalizedStats);

  // 하위 호환: 공용 DB 집계도 함께 유지 (점진적 분리 단계)
  await pool.query(APP_QUERIES.UPSERT_USER_STUDY_STATS, [
    userId,
    normalizedStats.totalStudyMinutes,
    normalizedStats.totalAttendanceCount,
    normalizedStats.totalAbsenceCount,
    normalizedStats.currentStreakDays,
    normalizedStats.participationScore,
  ]);
};

const getAttendanceSummary = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const [rows] = await pool.query(APP_QUERIES.SELECT_ATTENDANCE_SUMMARY_BY_USER_ID, [currentUser.user.id]);

  return {
    status: 200,
    body: {
      message: "출석 요약입니다.",
      summary: {
        totalRecords: Number(rows[0].totalRecords || 0),
        presentCount: Number(rows[0].presentCount || 0),
        lateCount: Number(rows[0].lateCount || 0),
        absentCount: Number(rows[0].absentCount || 0),
        totalMinutes: Number(rows[0].totalMinutes || 0),
      },
    },
  };
};

const listPersonalSchedules = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const startDateRaw = normalizeString(req.query.startDate);
  const endDateRaw = normalizeString(req.query.endDate);
  const startDate = startDateRaw ? normalizeScheduleDateText(startDateRaw) : null;
  const endDate = endDateRaw ? normalizeScheduleDateText(endDateRaw) : null;

  if ((startDateRaw && !startDate) || (endDateRaw && !endDate)) {
    return {
      status: 400,
      body: { message: "조회 범위 날짜 형식은 YYYY-MM-DD여야 합니다." },
    };
  }
  if (startDate && endDate && startDate > endDate) {
    return {
      status: 400,
      body: { message: "조회 시작일은 종료일보다 이전이거나 같아야 합니다." },
    };
  }

  await ensureTenantPersonalScheduleSchemaByUserId(currentUser.user.id);
  const { pool: tenantPool } = await getTenantPool(currentUser.user.id);

  const conditions = [];
  const params = [];
  if (startDate) {
    conditions.push(`schedule_date >= ?`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`schedule_date <= ?`);
    params.push(endDate);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows] = await tenantPool.query(
    `SELECT
        id,
        DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
        DATE_FORMAT(schedule_time, '%H:%i') AS schedule_time,
        title,
        note,
        created_at,
        updated_at
     FROM personal_schedules
     ${whereClause}
     ORDER BY schedule_date ASC, schedule_time ASC, id ASC`,
    params,
  );

  return {
    status: 200,
    body: {
      message: "개인 일정 목록입니다.",
      schedules: rows.map(mapPersonalSchedule),
    },
  };
};

const createPersonalSchedule = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const scheduleDate = normalizeScheduleDateText(req.body.date || req.body.scheduleDate);
  const scheduleTime = normalizeScheduleTimeText(req.body.time || req.body.scheduleTime);
  const title = normalizeString(req.body.title).slice(0, 120);
  const noteRaw = normalizeNullableString(req.body.note);
  const note = noteRaw ? noteRaw.slice(0, 1000) : null;

  if (!scheduleDate) {
    return { status: 400, body: { message: "일정 날짜 형식은 YYYY-MM-DD여야 합니다." } };
  }
  if (!scheduleTime) {
    return { status: 400, body: { message: "일정 시간 형식은 HH:MM이어야 합니다." } };
  }
  if (!title) {
    return { status: 400, body: { message: "일정 제목을 입력해주세요." } };
  }

  await ensureTenantPersonalScheduleSchemaByUserId(currentUser.user.id);
  const { pool: tenantPool } = await getTenantPool(currentUser.user.id);

  const [insertResult] = await tenantPool.query(
    `INSERT INTO personal_schedules (schedule_date, schedule_time, title, note)
     VALUES (?, ?, ?, ?)`,
    [scheduleDate, `${scheduleTime}:00`, title, note],
  );

  const [rows] = await tenantPool.query(
    `SELECT
        id,
        DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date,
        DATE_FORMAT(schedule_time, '%H:%i') AS schedule_time,
        title,
        note,
        created_at,
        updated_at
     FROM personal_schedules
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId],
  );

  return {
    status: 201,
    body: {
      message: "개인 일정이 저장되었습니다.",
      schedule: rows[0] ? mapPersonalSchedule(rows[0]) : null,
    },
  };
};

const deletePersonalSchedule = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const scheduleId = toPositiveInt(req.params.scheduleId);
  if (!scheduleId) {
    return { status: 400, body: { message: "유효한 일정 ID가 필요합니다." } };
  }

  await ensureTenantPersonalScheduleSchemaByUserId(currentUser.user.id);
  const { pool: tenantPool } = await getTenantPool(currentUser.user.id);
  const [result] = await tenantPool.query(`DELETE FROM personal_schedules WHERE id = ? LIMIT 1`, [scheduleId]);

  if (Number(result.affectedRows || 0) === 0) {
    return { status: 404, body: { message: "삭제할 개인 일정을 찾을 수 없습니다." } };
  }

  return {
    status: 200,
    body: { message: "개인 일정이 삭제되었습니다." },
  };
};

const pickRewardTypeWithProbability = ({ absencePassProbability, gifticonProbability, missProbability }) => {
  const absence = Math.max(0, Number(absencePassProbability || 0));
  const gifticon = Math.max(0, Number(gifticonProbability || 0));
  const miss = Math.max(0, Number(missProbability || 0));
  const total = absence + gifticon + miss || 100;
  const roll = Math.random() * total;

  if (roll < absence) return "absence-pass";
  if (roll < absence + gifticon) return "gifticon";
  return "miss";
};

const getAcademyManagerScope = async (currentUser) => {
  if (!isOperatorUser(currentUser.user)) {
    return {
      error: {
        status: 403,
        body: { message: "학원 관리 권한이 필요합니다." },
      },
    };
  }

  await ensureAcademyManagementSchema();
  const { userAcademies, academyIds } = await getUserAcademyAccessContext(currentUser.user.id);
  if (academyIds.length === 0) {
    return {
      error: {
        status: 404,
        body: { message: "연결된 학원 정보가 없습니다." },
      },
    };
  }

  return {
    academyIds,
    userAcademies,
    primaryAcademyId: academyIds[0],
  };
};

const listRewardContext = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureAcademyManagementSchema();
  const [groupRows] = await pool.query(APP_QUERIES.SELECT_MY_STUDY_GROUPS, [
    currentUser.user.id,
    currentUser.user.id,
    currentUser.user.id,
  ]);

  const groups = groupRows.map(mapStudyGroup);
  const groupIds = groups.map((group) => Number(group.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (groupIds.length === 0) {
    return {
      status: 200,
      body: {
        message: "리워드 정보입니다.",
      settings: {
        dailySpinLimit: 2,
        probabilities: {
          absencePass: 4,
          gifticon: 4,
          miss: 92,
        },
      },
      activitySettingsByActivity: {},
      groups: [],
      remainingSpinsByActivity: {},
      inventory: [],
        rewardHistory: [],
      },
    };
  }

  const placeholders = groupIds.map(() => "?").join(", ");
  const todayKey = toDateKeyInKst(new Date());

  const [spinRows] = await pool.query(
    `SELECT study_group_id, COUNT(*) AS spins_used
     FROM reward_spin_logs
     WHERE user_id = ?
       AND spun_on = ?
       AND study_group_id IN (${placeholders})
     GROUP BY study_group_id`,
    [currentUser.user.id, todayKey, ...groupIds],
  );

  const [inventoryRows] = await pool.query(
    `SELECT study_group_id, quantity
     FROM reward_inventories
     WHERE user_id = ?
       AND reward_type = 'absence-pass'
       AND study_group_id IN (${placeholders})`,
    [currentUser.user.id, ...groupIds],
  );

  const [historyRows] = await pool.query(
    `SELECT id, study_group_id, reward_type, reward_label, created_at
     FROM reward_spin_logs
     WHERE user_id = ?
       AND reward_type <> 'miss'
       AND study_group_id IN (${placeholders})
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [currentUser.user.id, ...groupIds],
  );

  const [settingsRows] = await pool.query(
    `SELECT academy_id, absence_pass_probability, gifticon_probability, miss_probability, daily_spin_limit
     FROM academy_reward_settings
     WHERE academy_id IN (${groups
       .map((group) => Number(group.academyId))
       .filter((id) => Number.isInteger(id) && id > 0)
       .map(() => "?")
       .join(",") || "0"})`,
    groups
      .map((group) => Number(group.academyId))
      .filter((id) => Number.isInteger(id) && id > 0),
  );

  const settingsByAcademyId = new Map(settingsRows.map((row) => [Number(row.academy_id), row]));
  const spinsByGroupId = new Map(spinRows.map((row) => [Number(row.study_group_id), Number(row.spins_used || 0)]));
  const inventoryByGroupId = new Map(
    inventoryRows.map((row) => [Number(row.study_group_id), Number(row.quantity || 0)]),
  );
  const groupNameById = new Map(groups.map((group) => [Number(group.id), group.name]));

  return {
    status: 200,
    body: {
      message: "리워드 정보입니다.",
      groups,
      settings: {
        dailySpinLimit: 2,
        probabilities: {
          absencePass: 4,
          gifticon: 4,
          miss: 92,
        },
      },
      activitySettingsByActivity: Object.fromEntries(
        groups.map((group) => {
          const academySetting = settingsByAcademyId.get(Number(group.academyId));
          return [
            String(group.id),
            {
              dailySpinLimit: Number(academySetting?.daily_spin_limit || 2),
              probabilities: {
                absencePass: Number(academySetting?.absence_pass_probability || 4),
                gifticon: Number(academySetting?.gifticon_probability || 4),
                miss: Number(academySetting?.miss_probability || 92),
              },
            },
          ];
        }),
      ),
      remainingSpinsByActivity: Object.fromEntries(
        groups.map((group) => {
          const academySetting = settingsByAcademyId.get(Number(group.academyId));
          const dailySpinLimit = Number(academySetting?.daily_spin_limit || 2);
          const spinsUsed = Number(spinsByGroupId.get(Number(group.id)) || 0);
          return [String(group.id), Math.max(0, dailySpinLimit - spinsUsed)];
        }),
      ),
      inventory: groups.map((group) => ({
        activityId: group.id,
        activityName: group.name,
        subject: group.subject,
        exemptionTicketCount: Number(inventoryByGroupId.get(Number(group.id)) || 0),
      })),
      rewardHistory: historyRows.map((row) => ({
        id: String(row.id),
        activityId: Number(row.study_group_id),
        activityName: groupNameById.get(Number(row.study_group_id)) || "활동",
        rewardType: row.reward_type,
        rewardLabel: row.reward_label,
        acquiredAt: row.created_at,
      })),
    },
  };
};

const spinReward = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureAcademyManagementSchema();

  const studyGroupId = toPositiveInt(req.body.studyGroupId);
  if (!studyGroupId) {
    return { status: 400, body: { message: "룰렛을 돌릴 활동을 선택해주세요." } };
  }

  const [groupRows] = await pool.query(APP_QUERIES.SELECT_MY_STUDY_GROUPS, [
    currentUser.user.id,
    currentUser.user.id,
    currentUser.user.id,
  ]);
  const group = groupRows.find((item) => Number(item.id) === studyGroupId);
  if (!group) {
    return { status: 404, body: { message: "참여 중인 활동만 룰렛을 돌릴 수 있습니다." } };
  }

  const academyId = toPositiveInt(group.academy_id);
  const [settingRows] = academyId
    ? await pool.query(
        `SELECT academy_id, absence_pass_probability, gifticon_probability, miss_probability, daily_spin_limit
         FROM academy_reward_settings
         WHERE academy_id = ?
         LIMIT 1`,
        [academyId],
      )
    : [[]];
  const setting = settingRows[0] || {
    absence_pass_probability: 4,
    gifticon_probability: 4,
    miss_probability: 92,
    daily_spin_limit: 2,
  };
  const todayKey = toDateKeyInKst(new Date());
  const [usageRows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM reward_spin_logs
     WHERE user_id = ?
       AND study_group_id = ?
       AND spun_on = ?`,
    [currentUser.user.id, studyGroupId, todayKey],
  );
  const spinsUsed = Number(usageRows[0]?.count || 0);
  const dailySpinLimit = Number(setting.daily_spin_limit || 2);

  if (spinsUsed >= dailySpinLimit) {
    return { status: 409, body: { message: "오늘 사용할 수 있는 룰렛 횟수를 모두 사용했어요." } };
  }

  const rewardType = pickRewardTypeWithProbability({
    absencePassProbability: setting.absence_pass_probability,
    gifticonProbability: setting.gifticon_probability,
    missProbability: setting.miss_probability,
  });
  const rewardLabel =
    rewardType === "absence-pass"
      ? "결석 면제권"
      : rewardType === "gifticon"
        ? "기프티콘 1,000원"
        : "꽝";

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [spinResult] = await connection.query(
      `INSERT INTO reward_spin_logs (user_id, academy_id, study_group_id, reward_type, reward_label, spun_on)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [currentUser.user.id, academyId, studyGroupId, rewardType, rewardLabel, todayKey],
    );

    if (rewardType === "absence-pass") {
      await connection.query(
        `INSERT INTO reward_inventories (user_id, study_group_id, reward_type, quantity)
         VALUES (?, ?, 'absence-pass', 1)
         ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
        [currentUser.user.id, studyGroupId],
      );
    }

    await connection.commit();

    return {
      status: 201,
      body: {
        message: "룰렛 결과가 저장되었습니다.",
        result: {
          id: String(spinResult.insertId),
          studyGroupId,
          rewardType,
          rewardLabel,
          remainingSpins: Math.max(0, dailySpinLimit - (spinsUsed + 1)),
          acquiredAt: new Date().toISOString(),
        },
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const listAcademyManagementContext = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();
  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const academyIds = scope.academyIds;
  const placeholders = academyIds.map(() => "?").join(", ");

  const [studyRows] = await pool.query(
    `SELECT sg.id,
            sg.name,
            sg.subject,
            sg.description,
            sg.max_members,
            sg.is_active,
            sg.created_at,
            sg.updated_at,
            sg.academy_id,
            academy.name AS academy_name,
            COUNT(DISTINCT sgm.id) AS member_count
     FROM study_groups sg
     LEFT JOIN academies academy ON academy.id = sg.academy_id
     LEFT JOIN study_group_members sgm ON sgm.study_group_id = sg.id
     WHERE sg.academy_id IN (${placeholders})
     GROUP BY sg.id
     ORDER BY sg.created_at DESC`,
    academyIds,
  );

  const [noticeRows] = await pool.query(
    `SELECT an.id,
            an.academy_id,
            an.study_group_id,
            an.title,
            an.content,
            an.notice_image_url,
            an.created_at,
            an.updated_at,
            sg.name AS study_group_name
     FROM academy_notices an
     LEFT JOIN study_groups sg ON sg.id = an.study_group_id
     WHERE an.academy_id IN (${placeholders})
     ORDER BY an.created_at DESC, an.id DESC
     LIMIT 20`,
    academyIds,
  );

  const [rewardSettingRows] = await pool.query(
    `SELECT academy_id, absence_pass_probability, gifticon_probability, miss_probability, daily_spin_limit,
            attendance_rate_threshold, monthly_attendance_min_count, reward_description, updated_at
     FROM academy_reward_settings
     WHERE academy_id IN (${placeholders})`,
    academyIds,
  );

  const [recruitmentRows] = await pool.query(
    `${APP_QUERIES.SELECT_STUDY_RECRUITMENTS_BASE}
     WHERE r.academy_id IN (${placeholders})
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 20`,
    academyIds,
  );

  const [attendanceRows] = await pool.query(
    `SELECT sg.id AS study_group_id,
            sg.name AS study_group_name,
            u.id AS user_id,
            u.name AS user_name,
            u.login_id,
            SUM(
              CASE
                WHEN al.attendance_status IN ('present', 'late') THEN 1
                WHEN al.id IS NULL
                     AND ss.created_by = u.id
                     AND (
                       COALESCE(ss.study_duration_minutes, 0) > 0
                       OR ss.study_started_at IS NOT NULL
                       OR ss.ai_reviewed_at IS NOT NULL
                     )
                THEN 1
                ELSE 0
              END
            ) AS attended_count,
            SUM(CASE WHEN al.attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
            SUM(
              CASE
                WHEN al.id IS NOT NULL THEN 1
                WHEN al.id IS NULL
                     AND ss.created_by = u.id
                     AND (
                       COALESCE(ss.study_duration_minutes, 0) > 0
                       OR ss.study_started_at IS NOT NULL
                       OR ss.ai_reviewed_at IS NOT NULL
                     )
                THEN 1
                ELSE 0
              END
            ) AS total_count
     FROM study_groups sg
     JOIN study_group_members sgm ON sgm.study_group_id = sg.id
     JOIN users u ON u.id = sgm.user_id
     LEFT JOIN study_sessions ss ON ss.study_group_id = sg.id
     LEFT JOIN attendance_logs al ON al.study_session_id = ss.id AND al.user_id = u.id
     WHERE sg.academy_id IN (${placeholders})
       AND u.role = 'student'
     GROUP BY sg.id, u.id
     ORDER BY sg.name ASC, u.name ASC`,
    academyIds,
  );

  return {
    status: 200,
    body: {
      message: "학원 관리 데이터입니다.",
      academies: scope.userAcademies,
      studies: studyRows.map(mapStudyGroup),
      notices: noticeRows.map((row) => ({
        id: Number(row.id),
        academyId: Number(row.academy_id),
        studyGroupId: row.study_group_id != null ? Number(row.study_group_id) : null,
        studyGroupName: row.study_group_name || null,
        title: row.title,
        content: row.content,
        imageUrl: row.notice_image_url || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      rewardSettings: rewardSettingRows.map((row) => ({
        academyId: Number(row.academy_id),
        absencePassProbability: Number(row.absence_pass_probability || 4),
        gifticonProbability: Number(row.gifticon_probability || 4),
        missProbability: Number(row.miss_probability || 92),
        dailySpinLimit: Number(row.daily_spin_limit || 2),
        attendanceRateThreshold: Number(row.attendance_rate_threshold || 80),
        monthlyAttendanceMinCount: Number(row.monthly_attendance_min_count || 0),
        rewardDescription: row.reward_description || "",
        updatedAt: row.updated_at,
      })),
      recruitments: recruitmentRows.map(toRecruitmentResponse),
      attendanceMembers: attendanceRows.map((row) => ({
        studyGroupId: Number(row.study_group_id),
        studyGroupName: row.study_group_name,
        userId: Number(row.user_id),
        userName: row.user_name,
        loginId: row.login_id,
        attendedCount: Number(row.attended_count || 0),
        absentCount: Number(row.absent_count || 0),
        totalCount: Number(row.total_count || 0),
        attendanceRate:
          Number(row.total_count || 0) > 0
            ? Math.round((Number(row.attended_count || 0) / Number(row.total_count || 0)) * 100)
            : 0,
      })),
    },
  };
};

const getStudyRecruitmentRowById = async (recruitmentId) => {
  const [[row]] = await pool.query(`${APP_QUERIES.SELECT_STUDY_RECRUITMENTS_BASE} WHERE r.id = ? LIMIT 1`, [
    recruitmentId,
  ]);
  return row || null;
};

const createStudyRecruitment = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const academyId = toPositiveInt(req.body.academyId) || scope.primaryAcademyId;
  if (!academyId || !scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "모집 공고를 등록할 권한이 없는 학원입니다." } };
  }

  const title = normalizeString(req.body.title).slice(0, 160);
  const targetClass = normalizeNullableString(req.body.targetClass)?.slice(0, 120) || null;
  const reviewScope = normalizeNullableString(req.body.reviewScope);
  const matchingGuide = normalizeNullableString(req.body.matchingGuide);
  const teamSize = Math.max(2, Math.min(12, toNumberOrDefault(req.body.teamSize, 4)));
  const minApplicants = Math.max(2, Math.min(100, toNumberOrDefault(req.body.minApplicants, teamSize)));
  const maxApplicantsRaw = toPositiveInt(req.body.maxApplicants);
  const maxApplicants = maxApplicantsRaw ? Math.max(minApplicants, Math.min(200, maxApplicantsRaw)) : null;
  const recruitmentStartAt = parseDateTime(req.body.recruitmentStartAt) || new Date();
  const recruitmentEndAt = parseDateTime(req.body.recruitmentEndAt);
  const applicationCheckConfig = normalizeRecruitmentApplicationCheckConfig(req.body.applicationCheckConfig);

  if (!title) {
    return { status: 400, body: { message: "모집 공고 제목을 입력해주세요." } };
  }
  if (!recruitmentEndAt) {
    return { status: 400, body: { message: "모집 마감 일시를 입력해주세요." } };
  }
  if (recruitmentEndAt.getTime() <= recruitmentStartAt.getTime()) {
    return { status: 400, body: { message: "모집 마감 일시는 현재 시각 이후여야 합니다." } };
  }

  const [result] = await pool.query(
    `INSERT INTO study_recruitments (
       academy_id,
       title,
       target_class,
       review_scope,
       ai_topic_examples,
       recruitment_start_at,
       recruitment_end_at,
       min_applicants,
       max_applicants,
       team_size,
       matching_guide,
       application_check_config,
       status,
       created_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [
      academyId,
      title,
      targetClass,
      reviewScope,
      stringifyJsonArray([], 6, 60),
      recruitmentStartAt,
      recruitmentEndAt,
      minApplicants,
      maxApplicants,
      teamSize,
      matchingGuide,
      stringifyRecruitmentApplicationCheckConfig(applicationCheckConfig),
      currentUser.user.id,
    ],
  );

  const row = await getStudyRecruitmentRowById(result.insertId);
  if (!row) {
    return { status: 500, body: { message: "모집 공고 저장 결과를 확인하지 못했습니다." } };
  }

  return {
    status: 201,
    body: {
      message: "스터디 모집 공고를 등록했습니다.",
      recruitment: toRecruitmentResponse(row),
    },
  };
};

const updateStudyRecruitment = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "수정할 스터디 공고를 찾을 수 없습니다." } };
  }

  const recruitmentRow = await getStudyRecruitmentRowById(recruitmentId);
  if (!recruitmentRow) {
    return { status: 404, body: { message: "수정할 스터디 공고를 찾을 수 없습니다." } };
  }

  const academyId = toPositiveInt(recruitmentRow.academy_id);
  if (!academyId || !scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "스터디 공고를 수정할 권한이 없는 학원입니다." } };
  }

  const title = normalizeString(req.body.title).slice(0, 160);
  const targetClass = normalizeNullableString(req.body.targetClass)?.slice(0, 120) || null;
  const hasReviewScope = Object.prototype.hasOwnProperty.call(req.body, "reviewScope");
  const reviewScope = hasReviewScope ? normalizeNullableString(req.body.reviewScope) : recruitmentRow.review_scope || null;
  const matchingGuide = normalizeNullableString(req.body.matchingGuide);
  const teamSize = Math.max(2, Math.min(12, toNumberOrDefault(req.body.teamSize, recruitmentRow.team_size || 4)));
  const minApplicants = Math.max(
    2,
    Math.min(100, toNumberOrDefault(req.body.minApplicants, recruitmentRow.min_applicants || teamSize)),
  );
  const maxApplicantsRaw = toPositiveInt(req.body.maxApplicants);
  const maxApplicants =
    maxApplicantsRaw != null && maxApplicantsRaw > 0
      ? Math.max(minApplicants, Math.min(200, maxApplicantsRaw))
      : recruitmentRow.max_applicants != null
        ? Math.max(minApplicants, Math.min(200, toNumberOrDefault(recruitmentRow.max_applicants, minApplicants)))
        : null;
  const recruitmentStartAt = parseDateTime(req.body.recruitmentStartAt);
  const recruitmentEndAt = parseDateTime(req.body.recruitmentEndAt);

  if (!title) {
    return { status: 400, body: { message: "모집 공고 제목을 입력해주세요." } };
  }
  if (!recruitmentStartAt || !recruitmentEndAt) {
    return { status: 400, body: { message: "모집 시작/종료 일시를 모두 입력해주세요." } };
  }
  if (recruitmentEndAt.getTime() <= recruitmentStartAt.getTime()) {
    return { status: 400, body: { message: "모집 종료 일시는 모집 시작 일시 이후여야 합니다." } };
  }

  const applicationCheckConfigRaw =
    req.body.applicationCheckConfig != null
      ? stringifyRecruitmentApplicationCheckConfig(req.body.applicationCheckConfig)
      : recruitmentRow.application_check_config;

  await pool.query(
    `UPDATE study_recruitments
     SET title = ?,
         target_class = ?,
         review_scope = ?,
         recruitment_start_at = ?,
         recruitment_end_at = ?,
         min_applicants = ?,
         max_applicants = ?,
         team_size = ?,
         matching_guide = ?,
         application_check_config = ?,
         updated_at = NOW()
     WHERE id = ?
     LIMIT 1`,
    [
      title,
      targetClass,
      reviewScope,
      recruitmentStartAt,
      recruitmentEndAt,
      minApplicants,
      maxApplicants,
      teamSize,
      matchingGuide,
      applicationCheckConfigRaw,
      recruitmentId,
    ],
  );

  const updatedRow = await getStudyRecruitmentRowById(recruitmentId);
  if (!updatedRow) {
    return { status: 500, body: { message: "스터디 공고 수정 결과를 확인하지 못했습니다." } };
  }

  return {
    status: 200,
    body: {
      message: "스터디 공고를 수정했습니다.",
      recruitment: toRecruitmentResponse(updatedRow),
    },
  };
};

const deleteStudyRecruitment = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyRecruitmentSchema();

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const recruitmentId = toPositiveInt(req.params.recruitmentId);
  if (!recruitmentId) {
    return { status: 400, body: { message: "삭제할 스터디 공고를 찾을 수 없습니다." } };
  }

  const recruitmentRow = await getStudyRecruitmentRowById(recruitmentId);
  if (!recruitmentRow) {
    return { status: 404, body: { message: "삭제할 스터디 공고를 찾을 수 없습니다." } };
  }

  const academyId = toPositiveInt(recruitmentRow.academy_id);
  if (!academyId || !scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "스터디 공고를 삭제할 권한이 없는 학원입니다." } };
  }

  await pool.query(
    `DELETE FROM study_recruitments
     WHERE id = ?
     LIMIT 1`,
    [recruitmentId],
  );

  return {
    status: 200,
    body: {
      message: "스터디 공고를 삭제했습니다.",
    },
  };
};

const createAcademyStudySetup = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureAcademyManagementSchema();
  await ensureStudyRecruitmentSchema();

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const academyId = toPositiveInt(req.body.academyId) || scope.primaryAcademyId;
  if (!academyId || !scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "스터디 공고를 생성할 권한이 없는 학원입니다." } };
  }

  const recruitmentTitle = normalizeString(req.body.recruitmentTitle || req.body.title).slice(0, 160);
  const recruitmentTargetClass = normalizeNullableString(req.body.recruitmentTargetClass || req.body.targetClass)?.slice(0, 120) || null;
  const recruitmentReviewScope = normalizeNullableString(req.body.recruitmentReviewScope || req.body.reviewScope);
  const recruitmentStartAt = parseDateTime(req.body.recruitmentStartAt) || new Date();
  const recruitmentEndAt = parseDateTime(req.body.recruitmentEndAt);
  const recruitmentTeamSize = Math.max(2, Math.min(12, toNumberOrDefault(req.body.recruitmentTeamSize || req.body.teamSize, 4)));
  const recruitmentMinApplicants = Math.max(
    2,
    Math.min(
      100,
      toNumberOrDefault(req.body.recruitmentMinApplicants || req.body.minApplicants, recruitmentTeamSize),
    ),
  );
  const recruitmentMaxApplicantsRaw = toPositiveInt(req.body.recruitmentMaxApplicants || req.body.maxApplicants);
  const recruitmentMaxApplicants = recruitmentMaxApplicantsRaw
    ? Math.max(recruitmentMinApplicants, Math.min(200, recruitmentMaxApplicantsRaw))
    : null;
  const recruitmentGuide = normalizeNullableString(req.body.recruitmentGuide || req.body.matchingGuide);
  const applicationCheckConfig = normalizeRecruitmentApplicationCheckConfig(req.body.applicationCheckConfig);
  const weeklyDayLabelByCode = {
    mon: "월",
    tue: "화",
    wed: "수",
    thu: "목",
    fri: "금",
    sat: "토",
    sun: "일",
  };
  const weeklyDayRawList = Array.isArray(req.body.studyWeeklyDays)
    ? req.body.studyWeeklyDays
    : normalizeString(req.body.studyWeeklyDays)
      ? String(req.body.studyWeeklyDays)
          .split(",")
          .map((item) => item.trim())
      : [];
  const studyWeeklyDays = Array.from(
    new Set(
      weeklyDayRawList
        .map((item) => normalizeString(item).slice(0, 3))
        .filter((item) => Object.prototype.hasOwnProperty.call(weeklyDayLabelByCode, item)),
    ),
  );
  const studyClassTime = normalizeNullableString(req.body.studyClassTime || req.body.studyClassTimeRange);
  const monthlyAttendanceMinCount = Math.max(
    1,
    Math.min(31, Math.floor(toNumberOrDefault(req.body.monthlyAttendanceMinCount, 0))),
  );
  const weeklyMeetingCount = Math.max(1, studyWeeklyDays.length || 1);
  const estimatedMonthlySessions = Math.max(4, weeklyMeetingCount * 4);
  const attendanceRateThreshold = Math.max(
    0,
    Math.min(
      100,
      Number(
        Number.isFinite(Number(req.body.attendanceRateThreshold))
          ? Number(req.body.attendanceRateThreshold)
          : Number(((monthlyAttendanceMinCount / estimatedMonthlySessions) * 100).toFixed(2)),
      ),
    ),
  );
  const rewardDescription = normalizeNullableString(req.body.rewardDescription);

  if (!recruitmentTitle || !recruitmentEndAt) {
    return { status: 400, body: { message: "학생 모집 공고 정보를 모두 입력해주세요." } };
  }
  if (!Number.isFinite(attendanceRateThreshold) || !rewardDescription) {
    return { status: 400, body: { message: "보상 기준 설정을 모두 입력해주세요." } };
  }
  if (!studyClassTime || studyWeeklyDays.length === 0) {
    return { status: 400, body: { message: "운영 요일과 학원 수업 시간을 입력해주세요." } };
  }
  if (recruitmentStartAt.getTime() < Date.now() - 60000) {
    return { status: 400, body: { message: "모집 시작 일시는 현재 시각 이후로 설정해주세요." } };
  }
  if (recruitmentEndAt.getTime() <= recruitmentStartAt.getTime()) {
    return { status: 400, body: { message: "모집 종료 일시는 모집 시작 일시 이후여야 합니다." } };
  }

  const weeklyDayLabel = studyWeeklyDays.map((code) => weeklyDayLabelByCode[code]).filter(Boolean).join(", ");
  const scheduleGuide = `운영 요일: 매주 ${weeklyDayLabel}\n학원 연계 수업 시간: ${studyClassTime}`;
  const mergedRecruitmentGuide = [recruitmentGuide, scheduleGuide].filter(Boolean).join("\n\n");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [settingRows] = await connection.query(
      `SELECT absence_pass_probability, gifticon_probability, miss_probability, daily_spin_limit
       FROM academy_reward_settings
       WHERE academy_id = ?
       LIMIT 1`,
      [academyId],
    );
    const baseSetting = settingRows[0] || {};

    await connection.query(
      `INSERT INTO academy_reward_settings (
         academy_id, absence_pass_probability, gifticon_probability, miss_probability, daily_spin_limit,
         attendance_rate_threshold, monthly_attendance_min_count, reward_description, created_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         absence_pass_probability = VALUES(absence_pass_probability),
         gifticon_probability = VALUES(gifticon_probability),
         miss_probability = VALUES(miss_probability),
         daily_spin_limit = VALUES(daily_spin_limit),
         attendance_rate_threshold = VALUES(attendance_rate_threshold),
         monthly_attendance_min_count = VALUES(monthly_attendance_min_count),
         reward_description = VALUES(reward_description),
         created_by = VALUES(created_by)`,
      [
        academyId,
        Number(baseSetting.absence_pass_probability || 4),
        Number(baseSetting.gifticon_probability || 4),
        Number(baseSetting.miss_probability || 92),
        Number(baseSetting.daily_spin_limit || 2),
        attendanceRateThreshold,
        monthlyAttendanceMinCount,
        rewardDescription,
        currentUser.user.id,
      ],
    );

    await connection.query(
      `INSERT INTO study_recruitments (
         academy_id,
         title,
         target_class,
         review_scope,
         ai_topic_examples,
         recruitment_start_at,
         recruitment_end_at,
         min_applicants,
         max_applicants,
         team_size,
         matching_guide,
         application_check_config,
         status,
         created_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        academyId,
        recruitmentTitle,
        recruitmentTargetClass,
        recruitmentReviewScope,
        stringifyJsonArray([], 6, 60),
        recruitmentStartAt,
        recruitmentEndAt,
        recruitmentMinApplicants,
        recruitmentMaxApplicants,
        recruitmentTeamSize,
        mergedRecruitmentGuide,
        stringifyRecruitmentApplicationCheckConfig(applicationCheckConfig),
        currentUser.user.id,
      ],
    );

    await connection.commit();
    return {
      status: 201,
      body: {
        message: "스터디 공고와 보상 기준이 저장되었습니다. 신청자 매칭 완료 후 운영 스터디가 생성됩니다.",
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getAcademyNoticeDetailById = async (noticeId) => {
  const [rows] = await pool.query(
    `SELECT an.id,
            an.academy_id,
            an.study_group_id,
            an.title,
            an.content,
            an.notice_image_url,
            an.created_at,
            an.updated_at,
            sg.name AS study_group_name
     FROM academy_notices an
     LEFT JOIN study_groups sg ON sg.id = an.study_group_id
     WHERE an.id = ?
     LIMIT 1`,
    [noticeId],
  );
  return rows[0] || null;
};

const toAcademyNoticeResponse = (row) => ({
  id: Number(row.id),
  academyId: Number(row.academy_id),
  studyGroupId: row.study_group_id != null ? Number(row.study_group_id) : null,
  studyGroupName: row.study_group_name || null,
  title: row.title,
  content: row.content,
  imageUrl: row.notice_image_url || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const listAcademyNotices = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyGroupsAcademySchema();
  await ensureAcademyManagementSchema();
  await ensureTenantAcademiesSchemaByUserId(currentUser.user.id);

  const userId = currentUser.user.id;
  const { academyIds } = await getUserAcademyAccessContext(userId);
  const hasNoticeIdQuery = req.query.noticeId != null && normalizeString(req.query.noticeId) !== "";
  const noticeId = hasNoticeIdQuery ? toPositiveInt(req.query.noticeId) : null;
  const requestedPage = toPositiveInt(req.query.page) || 1;
  const requestedPageSize = toPositiveInt(req.query.pageSize) || 10;
  const pageSize = Math.min(20, Math.max(1, requestedPageSize));
  const keyword = normalizeString(req.query.q).slice(0, 80);
  const rawStartDate = normalizeString(req.query.startDate);
  const rawEndDate = normalizeString(req.query.endDate);
  const startDate = rawStartDate ? normalizeScheduleDateText(rawStartDate) : null;
  const endDate = rawEndDate ? normalizeScheduleDateText(rawEndDate) : null;

  if (rawStartDate && !startDate) {
    return { status: 400, body: { message: "시작일 형식이 올바르지 않습니다. (YYYY-MM-DD)" } };
  }
  if (hasNoticeIdQuery && !noticeId) {
    return { status: 400, body: { message: "공지 ID 형식이 올바르지 않습니다." } };
  }
  if (rawEndDate && !endDate) {
    return { status: 400, body: { message: "종료일 형식이 올바르지 않습니다. (YYYY-MM-DD)" } };
  }
  if (startDate && endDate && startDate > endDate) {
    return { status: 400, body: { message: "시작일은 종료일보다 늦을 수 없습니다." } };
  }

  if (academyIds.length === 0) {
    return {
      status: 200,
      body: {
        message: "등록된 학원이 없어 표시할 공지가 없습니다.",
        notices: [],
        page: 1,
        pageSize,
        totalCount: 0,
        totalPages: 1,
      },
    };
  }

  const whereClauses = [`an.academy_id IN (${academyIds.map(() => "?").join(", ")})`];
  const whereParams = [...academyIds];

  if (!isOperatorUser(currentUser.user)) {
    const [memberGroupRows] = await pool.query(
      `SELECT DISTINCT study_group_id
       FROM study_group_members
       WHERE user_id = ?`,
      [userId],
    );
    const studyGroupIds = Array.from(
      new Set(
        memberGroupRows
          .map((row) => toPositiveInt(row.study_group_id))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
    const studyNoticeClause =
      studyGroupIds.length > 0 ? `OR an.study_group_id IN (${studyGroupIds.map(() => "?").join(", ")})` : "";
    whereClauses.push(`(an.study_group_id IS NULL ${studyNoticeClause})`);
    whereParams.push(...studyGroupIds);
  }

  if (keyword) {
    whereClauses.push(
      `(an.title LIKE CONCAT('%', ?, '%')
        OR an.content LIKE CONCAT('%', ?, '%')
        OR COALESCE(sg.name, '') LIKE CONCAT('%', ?, '%'))`,
    );
    whereParams.push(keyword, keyword, keyword);
  }

  if (noticeId) {
    whereClauses.push(`an.id = ?`);
    whereParams.push(noticeId);
  }

  if (startDate) {
    whereClauses.push(`DATE(DATE_ADD(an.created_at, INTERVAL 9 HOUR)) >= ?`);
    whereParams.push(startDate);
  }

  if (endDate) {
    whereClauses.push(`DATE(DATE_ADD(an.created_at, INTERVAL 9 HOUR)) <= ?`);
    whereParams.push(endDate);
  }

  const whereSql = whereClauses.join(" AND ");
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM academy_notices an
     LEFT JOIN study_groups sg ON sg.id = an.study_group_id
     WHERE ${whereSql}`,
    whereParams,
  );
  const totalCount = Number(countRows?.[0]?.count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT an.id,
            an.academy_id,
            an.study_group_id,
            sg.name AS study_group_name,
            an.title,
            an.content,
            an.notice_image_url,
            an.created_at,
            an.updated_at
     FROM academy_notices an
     LEFT JOIN study_groups sg ON sg.id = an.study_group_id
     WHERE ${whereSql}
     ORDER BY an.created_at DESC, an.id DESC
     LIMIT ? OFFSET ?`,
    [...whereParams, pageSize, offset],
  );

  return {
    status: 200,
    body: {
      message: "학원 공지 목록입니다.",
      notices: rows.map(toAcademyNoticeResponse),
      page,
      pageSize,
      totalCount,
      totalPages,
    },
  };
};

const createAcademyNotice = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const academyId = toPositiveInt(req.body.academyId) || scope.primaryAcademyId;
  const noticeTypeRaw = normalizeString(req.body.noticeType).toLowerCase();
  const requestedStudyGroupId = toPositiveInt(req.body.studyGroupId);
  const noticeType =
    noticeTypeRaw === "all" ? "all" : noticeTypeRaw === "study" ? "study" : requestedStudyGroupId ? "study" : "all";
  const studyGroupId = noticeType === "all" ? null : requestedStudyGroupId;
  const title = normalizeString(req.body.title);
  const content = normalizeString(req.body.content);

  if (!academyId || !scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "공지 등록 권한이 없는 학원입니다." } };
  }
  if (noticeType === "study" && !studyGroupId) {
    return { status: 400, body: { message: "스터디 공지를 선택한 경우 운영 스터디를 선택해주세요." } };
  }
  if (!title || !content) {
    return { status: 400, body: { message: "공지 제목과 내용을 입력해주세요." } };
  }

  if (studyGroupId) {
    const [studyRows] = await pool.query(
      `SELECT id, name
       FROM study_groups
       WHERE id = ? AND academy_id = ?
       LIMIT 1`,
      [studyGroupId, academyId],
    );
    if (!studyRows[0]) {
      return { status: 404, body: { message: "선택한 운영 스터디를 찾을 수 없습니다." } };
    }
  }

  let uploadedNoticeImage = null;
  if (req.file) {
    try {
      uploadedNoticeImage = await uploadProfileImage(req.file);
    } catch (error) {
      if (error && error.code === "MINIO_NOT_CONFIGURED") {
        return {
          status: 503,
          body: {
            message: "이미지 저장소(MinIO) 설정이 되어있지 않아 공지 이미지 업로드를 처리할 수 없습니다.",
          },
        };
      }
      return { status: 500, body: { message: "공지 이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요." } };
    }
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO academy_notices (academy_id, study_group_id, title, content, notice_image_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [academyId, studyGroupId, title, content, uploadedNoticeImage?.publicUrl || null, currentUser.user.id],
    );

    const noticeRow = await getAcademyNoticeDetailById(result.insertId);
    if (!noticeRow) {
      return { status: 500, body: { message: "공지사항 저장 결과를 확인하지 못했습니다." } };
    }

    return {
      status: 201,
      body: {
        message: "공지사항을 등록했습니다.",
        notice: toAcademyNoticeResponse(noticeRow),
      },
    };
  } catch (error) {
    if (uploadedNoticeImage?.objectName) {
      await removeProfileImage(uploadedNoticeImage.objectName);
    }

    return { status: 500, body: { message: "공지사항 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." } };
  }
};

const updateAcademyNotice = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const noticeId = toPositiveInt(req.params.noticeId);
  const noticeTypeRaw = normalizeString(req.body.noticeType).toLowerCase();
  const requestedStudyGroupId = toPositiveInt(req.body.studyGroupId);
  const noticeType =
    noticeTypeRaw === "all" ? "all" : noticeTypeRaw === "study" ? "study" : requestedStudyGroupId ? "study" : "all";
  const studyGroupId = noticeType === "all" ? null : requestedStudyGroupId;
  const title = normalizeString(req.body.title);
  const content = normalizeString(req.body.content);

  if (!noticeId) {
    return { status: 400, body: { message: "수정할 공지사항을 찾을 수 없습니다." } };
  }
  if (noticeType === "study" && !studyGroupId) {
    return { status: 400, body: { message: "스터디 공지를 선택한 경우 운영 스터디를 선택해주세요." } };
  }
  if (!title || !content) {
    return { status: 400, body: { message: "공지 제목과 내용을 입력해주세요." } };
  }

  const noticeRow = await getAcademyNoticeDetailById(noticeId);
  if (!noticeRow) {
    return { status: 404, body: { message: "수정할 공지사항을 찾을 수 없습니다." } };
  }

  const academyId = Number(noticeRow.academy_id);
  if (!scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "공지 수정 권한이 없는 학원입니다." } };
  }

  if (studyGroupId) {
    const [studyRows] = await pool.query(
      `SELECT id, name
       FROM study_groups
       WHERE id = ? AND academy_id = ?
       LIMIT 1`,
      [studyGroupId, academyId],
    );
    if (!studyRows[0]) {
      return { status: 404, body: { message: "선택한 운영 스터디를 찾을 수 없습니다." } };
    }
  }

  const currentNoticeImageUrl = normalizeNullableString(noticeRow.notice_image_url);

  let uploadedNoticeImage = null;
  if (req.file) {
    try {
      uploadedNoticeImage = await uploadProfileImage(req.file);
    } catch (error) {
      if (error && error.code === "MINIO_NOT_CONFIGURED") {
        return {
          status: 503,
          body: {
            message: "이미지 저장소(MinIO) 설정이 되어있지 않아 공지 이미지 업로드를 처리할 수 없습니다.",
          },
        };
      }
      return { status: 500, body: { message: "공지 이미지 업로드에 실패했습니다. 잠시 후 다시 시도해주세요." } };
    }
  }

  const nextNoticeImageUrl = uploadedNoticeImage?.publicUrl || currentNoticeImageUrl || null;

  try {
    await pool.query(
      `UPDATE academy_notices
       SET study_group_id = ?, title = ?, content = ?, notice_image_url = ?, updated_at = NOW()
       WHERE id = ?
       LIMIT 1`,
      [studyGroupId, title, content, nextNoticeImageUrl, noticeId],
    );
  } catch (error) {
    if (uploadedNoticeImage?.objectName) {
      await removeProfileImage(uploadedNoticeImage.objectName);
    }
    return { status: 500, body: { message: "공지사항 수정 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." } };
  }

  if (uploadedNoticeImage?.objectName) {
    const previousObjectName = resolveProfileImageObjectName(currentNoticeImageUrl);
    if (previousObjectName && previousObjectName !== uploadedNoticeImage.objectName) {
      await removeProfileImage(previousObjectName);
    }
  }

  const updatedNoticeRow = await getAcademyNoticeDetailById(noticeId);
  if (!updatedNoticeRow) {
    return { status: 500, body: { message: "공지사항 수정 결과를 확인하지 못했습니다." } };
  }

  return {
    status: 200,
    body: {
      message: "공지사항을 수정했습니다.",
      notice: toAcademyNoticeResponse(updatedNoticeRow),
    },
  };
};

const deleteAcademyNotice = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const noticeId = toPositiveInt(req.params.noticeId);
  if (!noticeId) {
    return { status: 400, body: { message: "삭제할 공지사항을 찾을 수 없습니다." } };
  }

  const noticeRow = await getAcademyNoticeDetailById(noticeId);
  if (!noticeRow) {
    return { status: 404, body: { message: "삭제할 공지사항을 찾을 수 없습니다." } };
  }

  const academyId = Number(noticeRow.academy_id);
  if (!scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "공지 삭제 권한이 없는 학원입니다." } };
  }

  await pool.query(
    `DELETE FROM academy_notices
     WHERE id = ?
     LIMIT 1`,
    [noticeId],
  );

  const previousObjectName = resolveProfileImageObjectName(noticeRow.notice_image_url);
  if (previousObjectName) {
    await removeProfileImage(previousObjectName);
  }

  return {
    status: 200,
    body: {
      message: "공지사항을 삭제했습니다.",
    },
  };
};

const upsertAcademyRewardSettings = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  const scope = await getAcademyManagerScope(currentUser);
  if (scope.error) return scope.error;

  const academyId = toPositiveInt(req.body.academyId) || scope.primaryAcademyId;
  if (!academyId || !scope.academyIds.includes(academyId)) {
    return { status: 403, body: { message: "보상 설정을 수정할 권한이 없는 학원입니다." } };
  }

  const absencePassProbability = Math.max(0, Math.min(100, Number(req.body.absencePassProbability ?? 4)));
  const gifticonProbability = Math.max(0, Math.min(100, Number(req.body.gifticonProbability ?? 4)));
  const missProbability = Math.max(0, Math.min(100, Number(req.body.missProbability ?? 92)));
  const dailySpinLimit = Math.max(1, Math.min(10, toNumberOrDefault(req.body.dailySpinLimit, 2)));
  const attendanceRateThreshold = Math.max(0, Math.min(100, Number(req.body.attendanceRateThreshold ?? 80)));
  const monthlyAttendanceMinCount = Math.max(1, Math.min(31, Math.floor(toNumberOrDefault(req.body.monthlyAttendanceMinCount, 0))));
  const rewardDescription = normalizeNullableString(req.body.rewardDescription);

  const probabilitySum = Number((absencePassProbability + gifticonProbability + missProbability).toFixed(2));
  if (Math.abs(probabilitySum - 100) > 0.01) {
    return { status: 400, body: { message: "보상 확률의 합은 100이어야 합니다." } };
  }

  if (!rewardDescription) {
    return { status: 400, body: { message: "보상 내용을 입력해주세요." } };
  }

  await pool.query(
    `INSERT INTO academy_reward_settings (
       academy_id, absence_pass_probability, gifticon_probability, miss_probability, daily_spin_limit,
       attendance_rate_threshold, monthly_attendance_min_count, reward_description, created_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       absence_pass_probability = VALUES(absence_pass_probability),
       gifticon_probability = VALUES(gifticon_probability),
       miss_probability = VALUES(miss_probability),
       daily_spin_limit = VALUES(daily_spin_limit),
       attendance_rate_threshold = VALUES(attendance_rate_threshold),
       monthly_attendance_min_count = VALUES(monthly_attendance_min_count),
       reward_description = VALUES(reward_description),
       created_by = VALUES(created_by)`,
    [
      academyId,
      absencePassProbability,
      gifticonProbability,
      missProbability,
      dailySpinLimit,
      attendanceRateThreshold,
      monthlyAttendanceMinCount,
      rewardDescription,
      currentUser.user.id,
    ],
  );

  return {
    status: 200,
    body: {
      message: "보상 설정을 저장했습니다.",
      settings: {
        academyId,
        absencePassProbability,
        gifticonProbability,
        missProbability,
        dailySpinLimit,
        attendanceRateThreshold,
        monthlyAttendanceMinCount,
        rewardDescription,
      },
    },
  };
};

const getDashboard = async (req) => {
  const currentUser = await requireCurrentUser(req);
  if (currentUser.error) return currentUser.error;

  await ensureStudyGroupsAcademySchema();
  await ensureAcademyManagementSchema();
  await ensureTenantAcademiesSchemaByUserId(currentUser.user.id);

  const userId = currentUser.user.id;
  const { academyIds } = await getUserAcademyAccessContext(userId);

  const statsRow = await getUserStudyStatsByUserId(userId);
  const [groupRows] = await pool.query(APP_QUERIES.SELECT_DASHBOARD_GROUPS_BY_USER_ID, [userId, userId]);
  const [sessionRows] = await pool.query(APP_QUERIES.SELECT_DASHBOARD_SESSIONS_BY_USER_ID, [userId]);
  const [rewardRows] = await pool.query(APP_QUERIES.SELECT_DASHBOARD_REWARDS_BY_USER_ID, [userId]);
  const [todayRows] = await pool.query(APP_QUERIES.SELECT_DASHBOARD_TODAY_SCHEDULE_BY_USER_ID, [userId]);
  let noticeRows = [];
  if (academyIds.length > 0) {
    if (isOperatorUser(currentUser.user)) {
      const [rows] = await pool.query(
        `SELECT an.id,
                an.academy_id,
                an.study_group_id,
                sg.name AS study_group_name,
                an.title,
                an.content,
                an.notice_image_url,
                an.created_at,
                an.updated_at
         FROM academy_notices an
         LEFT JOIN study_groups sg ON sg.id = an.study_group_id
         WHERE an.academy_id IN (${academyIds.map(() => "?").join(", ")})
         ORDER BY an.created_at DESC, an.id DESC
         LIMIT 4`,
        academyIds,
      );
      noticeRows = rows;
    } else {
      const [memberGroupRows] = await pool.query(
        `SELECT DISTINCT study_group_id
         FROM study_group_members
         WHERE user_id = ?`,
        [userId],
      );
      const studyGroupIds = Array.from(
        new Set(
          memberGroupRows
            .map((row) => toPositiveInt(row.study_group_id))
            .filter((value) => Number.isInteger(value) && value > 0),
        ),
      );
      const params = [...academyIds];
      const studyNoticeClause =
        studyGroupIds.length > 0 ? `OR an.study_group_id IN (${studyGroupIds.map(() => "?").join(", ")})` : "";
      params.push(...studyGroupIds);
      const [rows] = await pool.query(
        `SELECT an.id,
                an.academy_id,
                an.study_group_id,
                sg.name AS study_group_name,
                an.title,
                an.content,
                an.notice_image_url,
                an.created_at,
                an.updated_at
         FROM academy_notices an
         LEFT JOIN study_groups sg ON sg.id = an.study_group_id
         WHERE an.academy_id IN (${academyIds.map(() => "?").join(", ")})
           AND (an.study_group_id IS NULL ${studyNoticeClause})
         ORDER BY an.created_at DESC, an.id DESC
         LIMIT 4`,
        params,
      );
      noticeRows = rows;
    }
  }

  let academyMetrics = null;
  if (isOperatorUser(currentUser.user) && academyIds.length > 0) {
    const todayKst = toDateKeyInKst(new Date());
    const [academyMetricRows] = await pool.query(
      `SELECT
          COUNT(DISTINCT CASE WHEN u.role = 'student' THEN u.id END) AS student_count,
          COUNT(DISTINCT sg.id) AS study_count,
          COUNT(DISTINCT CASE
            WHEN (
              DATE(DATE_ADD(COALESCE(al.checked_in_at, ss.scheduled_start_at, ss.created_at), INTERVAL 9 HOUR)) = ?
              AND al.attendance_status IN ('present', 'late')
            )
            OR (
              al.id IS NULL
              AND ss.created_by = u.id
              AND (
                COALESCE(ss.study_duration_minutes, 0) > 0
                OR ss.study_started_at IS NOT NULL
                OR ss.ai_reviewed_at IS NOT NULL
              )
              AND DATE(
                DATE_ADD(
                  COALESCE(ss.ai_reviewed_at, ss.study_started_at, ss.scheduled_start_at, ss.created_at),
                  INTERVAL 9 HOUR
                )
              ) = ?
            )
            THEN u.id
          END) AS today_participant_count
       FROM study_groups sg
       LEFT JOIN study_group_members sgm ON sgm.study_group_id = sg.id
       LEFT JOIN users u ON u.id = sgm.user_id
       LEFT JOIN study_sessions ss ON ss.study_group_id = sg.id
       LEFT JOIN attendance_logs al ON al.study_session_id = ss.id AND al.user_id = u.id
       WHERE sg.academy_id IN (${academyIds.map(() => "?").join(", ")})`,
      [todayKst, todayKst, ...academyIds],
    );
    academyMetrics = academyMetricRows[0] || null;
  }

  return {
    status: 200,
    body: {
      message: "대시보드 데이터입니다.",
      user: mapAppUser(currentUser.user),
      metrics: {
        todaySessions: todayRows.length,
        totalStudyMinutes: Number(statsRow?.total_study_minutes || 0),
        attendanceRate:
          Number(statsRow?.total_attendance_count || 0) + Number(statsRow?.total_absence_count || 0) > 0
            ? Math.round(
                (Number(statsRow?.total_attendance_count || 0) /
                  (Number(statsRow?.total_attendance_count || 0) + Number(statsRow?.total_absence_count || 0))) *
                  100,
              )
            : 0,
        currentStreakDays: Number(statsRow?.current_streak_days || 0),
        participationScore: Number(statsRow?.participation_score || 0),
        studentCount: Number(academyMetrics?.student_count || 0),
        studyCount: Number(academyMetrics?.study_count || 0),
        todayParticipantCount: Number(academyMetrics?.today_participant_count || 0),
      },
      todaySchedule: todayRows.map((row) => ({
        id: row.id,
        title: row.topic_title,
        scheduledStartAt: row.scheduled_start_at,
        status: row.status,
        groupName: row.group_name,
      })),
      groups: groupRows.map(mapStudyGroup),
      sessions: sessionRows.map(mapStudySession),
      rewards: rewardRows,
      notices: noticeRows.map((row) => ({
        id: Number(row.id),
        academyId: Number(row.academy_id),
        studyGroupId: row.study_group_id != null ? Number(row.study_group_id) : null,
        studyGroupName: row.study_group_name || null,
        title: row.title,
        content: row.content,
        imageUrl: row.notice_image_url || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    },
  };
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  updateMyProfileImage,
  updateMyPassword,
  getStudyRoomContext,
  searchAcademies,
  registerMyAcademy,
  listStudyRecruitments,
  getStudyRecruitmentById,
  getStudyRecruitmentApplicants,
  getMyStudyRecruitmentApplication,
  upsertMyStudyRecruitmentApplication,
  runStudyRecruitmentMatching,
  previewStudyRecruitmentAiMatching,
  runStudyRecruitmentAiMatching,
  runStudyRecruitmentManualMatching,
  getMyStudyRecruitmentResult,
  listAcademyStudents,
  listFriends,
  listFriendRequests,
  createFriendRequest,
  respondToFriendRequest,
  removeFriend,
  listStudyGroups,
  createStudyGroup,
  updateStudyGroup,
  joinStudyGroup,
  listStudySessions,
  createStudySession,
  updateStudySession,
  uploadStudySessionContentImage,
  listAttendance,
  upsertAttendance,
  getAttendanceSummary,
  listPersonalSchedules,
  createPersonalSchedule,
  deletePersonalSchedule,
  listRewardContext,
  spinReward,
  listAcademyManagementContext,
  createAcademyNotice,
  updateAcademyNotice,
  deleteAcademyNotice,
  upsertAcademyRewardSettings,
  createAcademyStudySetup,
  createStudyRecruitment,
  updateStudyRecruitment,
  deleteStudyRecruitment,
  listAcademyNotices,
  getDashboard,
};
