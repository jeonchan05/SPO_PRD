const jwt = require("jsonwebtoken");
const {
  jwtSecret,
  jwtExpiresInSeconds,
  authCookieName,
  authCookieSameSite,
  authCookieSecure,
  authCookieDomain,
  jwtIssuer,
  jwtAudience,
} = require("../config/auth");

const createAccessToken = (user) =>
  jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
      loginId: user.loginId,
      typ: "access",
    },
    jwtSecret,
    {
      algorithm: "HS256",
      expiresIn: jwtExpiresInSeconds,
      issuer: jwtIssuer,
      audience: jwtAudience,
    },
  );

const verifyAccessToken = (token) =>
  jwt.verify(token, jwtSecret, {
    algorithms: ["HS256"],
    issuer: jwtIssuer,
    audience: jwtAudience,
  });

const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: authCookieSecure,
  sameSite: authCookieSameSite,
  path: "/",
  maxAge: jwtExpiresInSeconds * 1000,
  ...(authCookieDomain ? { domain: authCookieDomain } : {}),
});

const setAuthCookie = (res, token) => {
  res.cookie(authCookieName, token, getAuthCookieOptions());
};

const clearAuthCookie = (res) => {
  res.clearCookie(authCookieName, {
    httpOnly: true,
    secure: authCookieSecure,
    sameSite: authCookieSameSite,
    path: "/",
    ...(authCookieDomain ? { domain: authCookieDomain } : {}),
  });
};

module.exports = {
  authCookieName,
  createAccessToken,
  verifyAccessToken,
  setAuthCookie,
  clearAuthCookie,
};
