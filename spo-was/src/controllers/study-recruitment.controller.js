const { appService, createHandler } = require("./controller.helper");

const listStudyRecruitments = createHandler(appService.listStudyRecruitments);
const getStudyRecruitmentById = createHandler(appService.getStudyRecruitmentById);
const getMyStudyRecruitmentApplication = createHandler(appService.getMyStudyRecruitmentApplication);
const upsertMyStudyRecruitmentApplication = createHandler(appService.upsertMyStudyRecruitmentApplication);
const runStudyRecruitmentMatching = createHandler(appService.runStudyRecruitmentMatching);
const getStudyRecruitmentApplicants = createHandler(appService.getStudyRecruitmentApplicants);
const previewStudyRecruitmentAiMatching = createHandler(appService.previewStudyRecruitmentAiMatching);
const runStudyRecruitmentAiMatching = createHandler(appService.runStudyRecruitmentAiMatching);
const runStudyRecruitmentManualMatching = createHandler(appService.runStudyRecruitmentManualMatching);
const getMyStudyRecruitmentResult = createHandler(appService.getMyStudyRecruitmentResult);

module.exports = {
  listStudyRecruitments,
  getStudyRecruitmentById,
  getMyStudyRecruitmentApplication,
  upsertMyStudyRecruitmentApplication,
  runStudyRecruitmentMatching,
  getStudyRecruitmentApplicants,
  previewStudyRecruitmentAiMatching,
  runStudyRecruitmentAiMatching,
  runStudyRecruitmentManualMatching,
  getMyStudyRecruitmentResult,
};
