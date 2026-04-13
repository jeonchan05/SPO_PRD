const { appService, createHandler } = require("./controller.helper");

const listStudySessions = createHandler(appService.listStudySessions);
const createStudySession = createHandler(appService.createStudySession);
const updateStudySession = createHandler(appService.updateStudySession);
const uploadStudySessionContentImage = createHandler(appService.uploadStudySessionContentImage);

module.exports = {
  listStudySessions,
  createStudySession,
  updateStudySession,
  uploadStudySessionContentImage,
};
