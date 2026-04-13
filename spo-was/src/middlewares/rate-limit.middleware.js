const rateLimit = require("express-rate-limit");

const parseLimit = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const rateLimitMessage = {
  message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
};

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseLimit(process.env.AUTH_RATE_LIMIT_MAX, 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

const signInRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseLimit(process.env.SIGN_IN_RATE_LIMIT_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

const appRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseLimit(process.env.APP_RATE_LIMIT_MAX, 180),
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

module.exports = {
  appRateLimiter,
  authRateLimiter,
  signInRateLimiter,
};
