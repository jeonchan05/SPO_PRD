const appService = require("../services/app.service");
const exposeErrorDetails =
  String(process.env.EXPOSE_ERROR_DETAILS || "false")
    .trim()
    .toLowerCase() === "true" &&
  String(process.env.NODE_ENV || "")
    .trim()
    .toLowerCase() !== "production";

const buildInternalErrorBody = (message, error) => {
  const body = { message };
  if (exposeErrorDetails && error instanceof Error && error.message) {
    body.error = error.message;
  }
  return body;
};

const handleServiceResult = async (serviceCall, res, errorMessage = "핵심 기능 처리 중 오류가 발생했습니다.") => {
  try {
    const result = await serviceCall;
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json(buildInternalErrorBody(errorMessage, error));
  }
};

const createHandler =
  (serviceCallBuilder, options = {}) =>
  (req, res) =>
    handleServiceResult(serviceCallBuilder(req), res, options.errorMessage);

module.exports = {
  appService,
  buildInternalErrorBody,
  handleServiceResult,
  createHandler,
};
