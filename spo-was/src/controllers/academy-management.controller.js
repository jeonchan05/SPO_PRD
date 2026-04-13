const { appService, createHandler } = require("./controller.helper");

const listAcademyManagementContext = createHandler(appService.listAcademyManagementContext);
const createAcademyNotice = createHandler(appService.createAcademyNotice);
const updateAcademyNotice = createHandler(appService.updateAcademyNotice);
const deleteAcademyNotice = createHandler(appService.deleteAcademyNotice);
const upsertAcademyRewardSettings = createHandler(appService.upsertAcademyRewardSettings);
const createStudyRecruitment = createHandler(appService.createStudyRecruitment);
const updateStudyRecruitment = createHandler(appService.updateStudyRecruitment);
const deleteStudyRecruitment = createHandler(appService.deleteStudyRecruitment);
const createAcademyStudySetup = createHandler(appService.createAcademyStudySetup);

module.exports = {
  listAcademyManagementContext,
  createAcademyNotice,
  updateAcademyNotice,
  deleteAcademyNotice,
  upsertAcademyRewardSettings,
  createStudyRecruitment,
  updateStudyRecruitment,
  deleteStudyRecruitment,
  createAcademyStudySetup,
};
