const authService = require("../services/auth.service");
const { buildInternalErrorBody, handleServiceResult } = require("./controller.helper");
const { clearAuthCookie, createAccessToken, setAuthCookie } = require("../utils/jwt");

const checkLoginId = (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return handleServiceResult(authService.checkLoginIdAvailability(req.query), res, "인증 처리 중 오류가 발생했습니다.");
};
const signUp = (req, res) =>
  handleServiceResult(authService.signUp(req.body, req.file), res, "인증 처리 중 오류가 발생했습니다.");
const signIn = async (req, res) => {
  try {
    const result = await authService.signIn(req.body);
    if (result.status === 200 && result.body?.user) {
      const token = createAccessToken(result.body.user);
      setAuthCookie(res, token);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json(buildInternalErrorBody("인증 처리 중 오류가 발생했습니다.", error));
  }
};
const findId = (req, res) =>
  handleServiceResult(authService.findLoginId(req.body), res, "인증 처리 중 오류가 발생했습니다.");
const findPassword = (req, res) =>
  handleServiceResult(authService.resetPassword(req.body), res, "인증 처리 중 오류가 발생했습니다.");
const me = (req, res) => handleServiceResult(authService.getSessionUser(req.auth.userId), res, "인증 처리 중 오류가 발생했습니다.");
const signOut = (_req, res) => {
  clearAuthCookie(res);
  return res.status(200).json({ message: "로그아웃되었습니다." });
};

module.exports = {
  checkLoginId,
  signUp,
  signIn,
  findId,
  findPassword,
  me,
  signOut,
};
