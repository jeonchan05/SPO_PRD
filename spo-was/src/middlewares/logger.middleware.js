const crypto = require("crypto");
const { isIP } = require("net");

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordconfirm",
  "currentpassword",
  "newpassword",
  "newpasswordconfirm",
  "token",
  "authorization",
  "cookie",
  "access_token",
  "refresh_token",
  "secret",
  "minio_secret_key",
]);

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const colorize = (text, color) => `${ANSI[color] || ""}${text}${ANSI.reset}`;
const timestamp = () => new Date().toISOString();

const truncate = (value, maxLength = 160) => {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...(len=${text.length})`;
};

const toHeaderValues = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
};

const normalizeIp = (rawValue) => {
  if (typeof rawValue !== "string") return null;
  let value = rawValue.trim();
  if (!value) return null;

  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    value = value.slice(1, -1);
  }

  if (value.startsWith("for=")) {
    value = value.slice(4);
  }

  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  } else if (value.includes(".") && value.includes(":")) {
    value = value.split(":")[0];
  }

  if (value.startsWith("::ffff:")) {
    value = value.slice(7);
  }

  if (value.toLowerCase() === "localhost") {
    value = "127.0.0.1";
  }

  return isIP(value) ? value : null;
};

const isPrivateIPv4 = (ip) => {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;

  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
};

const isPrivateIPv6 = (ip) => {
  const value = ip.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  return false;
};

const isPublicIp = (ip) => {
  const family = isIP(ip);
  if (family === 4) return !isPrivateIPv4(ip);
  if (family === 6) return !isPrivateIPv6(ip);
  return false;
};

const sanitizeValue = (value, depth = 0) => {
  if (depth > 2) return "[Truncated]";
  if (value == null) return value;

  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 30);
    return entries.reduce((acc, [key, item]) => {
      const normalizedKey = String(key || "").toLowerCase();
      acc[key] = SENSITIVE_KEYS.has(normalizedKey) ? "[REDACTED]" : sanitizeValue(item, depth + 1);
      return acc;
    }, {});
  }

  return String(value);
};

const stringifySafe = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[Unserializable]";
  }
};

const resolveMethodColor = (method) => {
  switch (String(method || "").toUpperCase()) {
    case "GET":
      return "blue";
    case "POST":
      return "magenta";
    case "PUT":
    case "PATCH":
      return "yellow";
    case "DELETE":
      return "red";
    case "OPTIONS":
      return "cyan";
    default:
      return "gray";
  }
};

const resolveStatusColor = (statusCode) => {
  if (statusCode >= 500) return "red";
  if (statusCode >= 400) return "yellow";
  if (statusCode >= 300) return "cyan";
  if (statusCode >= 200) return "green";
  return "blue";
};

const resolveRequestId = (req) => {
  const fromHeader = req.headers["x-request-id"];
  if (typeof fromHeader === "string" && fromHeader.trim() && fromHeader.length <= 100) {
    return fromHeader.trim();
  }
  return crypto.randomUUID().split("-")[0];
};

const resolveClientIp = (req) => {
  const candidates = [];
  const forwardedChain = [];

  const addCandidate = (value, source) => {
    const normalized = normalizeIp(value);
    if (!normalized) return;
    candidates.push({ ip: normalized, source });
  };

  for (const value of toHeaderValues(req.headers["cf-connecting-ip"])) {
    addCandidate(value, "cf-connecting-ip");
  }

  for (const value of toHeaderValues(req.headers["x-real-ip"])) {
    addCandidate(value, "x-real-ip");
  }

  for (const rawHeader of toHeaderValues(req.headers["x-forwarded-for"])) {
    const items = String(rawHeader)
      .split(",")
      .map((entry) => normalizeIp(entry))
      .filter(Boolean);

    for (const item of items) {
      forwardedChain.push(item);
      candidates.push({ ip: item, source: "x-forwarded-for" });
    }
  }

  addCandidate(req.ip, "req.ip");
  addCandidate(req.socket?.remoteAddress, "socket.remoteAddress");

  const selected = candidates.find((entry) => isPublicIp(entry.ip)) || candidates[0] || null;

  return {
    clientIp: selected?.ip || "-",
    source: selected?.source || "unknown",
    forwardedChain: forwardedChain.length ? forwardedChain.join(",") : null,
  };
};

const extractBodyPreview = (req) => {
  if (!BODY_METHODS.has(String(req.method || "").toUpperCase())) return null;

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const fileMeta =
      req.file && req.file.fieldname
        ? `${req.file.fieldname}:${req.file.mimetype || "unknown"}:${req.file.size || 0}b`
        : null;

    return {
      type: "multipart/form-data",
      file: fileMeta,
      fields: sanitizeValue(req.body || {}),
    };
  }

  if (contentType.includes("application/json") || contentType.includes("application/x-www-form-urlencoded")) {
    if (!req.body || typeof req.body !== "object" || Object.keys(req.body).length === 0) return null;
    return sanitizeValue(req.body);
  }

  return null;
};

const requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();
  const requestId = resolveRequestId(req);
  const method = String(req.method || "GET").toUpperCase();
  const methodColor = resolveMethodColor(method);
  const url = req.originalUrl || req.url || "/";
  const { clientIp, source: ipSource, forwardedChain } = resolveClientIp(req);
  const userAgent = truncate(req.headers["user-agent"] || "-", 180);
  const queryPreview =
    req.query && typeof req.query === "object" && Object.keys(req.query).length > 0
      ? sanitizeValue(req.query)
      : null;
  const bodyPreview = extractBodyPreview(req);

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  console.log(
    `${colorize(timestamp(), "gray")} ${colorize(`[REQ ${requestId}]`, "cyan")} ${colorize(
      method.padEnd(7),
      methodColor,
    )} ${url}`,
  );
  console.log(
    `${colorize("  ip=", "gray")}${clientIp} ${colorize("src=", "gray")}${ipSource} ${colorize("ua=", "gray")}${userAgent}`,
  );

  if (forwardedChain) {
    console.log(`${colorize("  xff=", "gray")}${truncate(forwardedChain, 220)}`);
  }

  if (queryPreview) {
    console.log(`${colorize("  query=", "gray")}${stringifySafe(queryPreview)}`);
  }

  if (bodyPreview) {
    console.log(`${colorize("  body=", "gray")}${stringifySafe(bodyPreview)}`);
  }

  let finished = false;

  const logResponse = (closed = false) => {
    if (finished) return;
    finished = true;

    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const statusCode = res.statusCode || 0;
    const statusText = String(statusCode).padStart(3, " ");
    const bytes = res.getHeader("content-length") || "-";
    const label = closed ? "CLOSE" : "RES";
    const labelColor = closed ? "red" : "magenta";

    console.log(
      `${colorize(timestamp(), "gray")} ${colorize(`[${label} ${requestId}]`, labelColor)} ${colorize(
        statusText,
        resolveStatusColor(statusCode),
      )} ${method} ${url} ${elapsedMs.toFixed(1)}ms ${colorize("bytes=", "gray")}${bytes}`,
    );
  };

  res.once("finish", () => {
    logResponse(false);
  });

  res.once("close", () => {
    if (!res.writableEnded) {
      logResponse(true);
    }
  });

  next();
};

module.exports = {
  requestLogger,
};
