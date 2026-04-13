const { authCookieName, verifyAccessToken } = require("../utils/jwt");
const OPERATOR_ROLES = new Set(["operator", "admin", "mentor", "academy"]);

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const [scheme, token] = authorizationHeader.trim().split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
};

const requireAuth = (req, res, next) => {
  const cookieToken = req.cookies ? req.cookies[authCookieName] : null;
  const bearerToken = getBearerToken(req.headers.authorization);
  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  try {
    const payload = verifyAccessToken(token);
    const userId = toPositiveInt(payload.sub);

    if (!userId) {
      return res.status(401).json({ message: "유효하지 않은 인증 정보입니다." });
    }

    req.auth = {
      userId,
      role: payload.role,
      loginId: payload.loginId,
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ message: "인증이 만료되었거나 유효하지 않습니다." });
  }
};

const requireOperator = (req, res, next) => {
  const role = typeof req.auth?.role === "string" ? req.auth.role.trim().toLowerCase() : "";
  if (!OPERATOR_ROLES.has(role)) {
    return res.status(403).json({ message: "운영자 권한이 필요합니다." });
  }
  return next();
};

module.exports = {
  requireAuth,
  requireOperator,
};
