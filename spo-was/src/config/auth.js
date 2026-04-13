const crypto = require("crypto");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseSameSite = (value) => {
  const normalized = String(value || "lax").trim().toLowerCase();
  if (["lax", "strict", "none"].includes(normalized)) {
    return normalized;
  }
  return "lax";
};

const parseBool = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const rawSecret = String(process.env.JWT_SECRET || "").trim();
let jwtSecret = rawSecret;

if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production.");
  }

  jwtSecret = crypto.randomBytes(48).toString("hex");
  console.warn("[auth] JWT_SECRET is not set. Using an ephemeral development secret.");
}

if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long.");
}

const jwtExpiresInSeconds = parsePositiveInt(process.env.JWT_EXPIRES_IN_SECONDS, 60 * 60);
const authCookieName = String(process.env.AUTH_COOKIE_NAME || "spo_access_token").trim();
const authCookieSameSite = parseSameSite(process.env.AUTH_COOKIE_SAME_SITE);
const authCookieSecure = parseBool(process.env.AUTH_COOKIE_SECURE, process.env.NODE_ENV === "production");
const authCookieDomain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim() || undefined;
const jwtIssuer = String(process.env.JWT_ISSUER || "spo-was").trim();
const jwtAudience = String(process.env.JWT_AUDIENCE || "spo-client").trim();

if (authCookieSameSite === "none" && !authCookieSecure) {
  throw new Error("AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true.");
}

module.exports = {
  jwtSecret,
  jwtExpiresInSeconds,
  authCookieName,
  authCookieSameSite,
  authCookieSecure,
  authCookieDomain,
  jwtIssuer,
  jwtAudience,
};
