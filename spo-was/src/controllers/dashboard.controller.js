const { appService, createHandler } = require("./controller.helper");

const getDashboard = createHandler(appService.getDashboard);
const listAcademyNotices = createHandler(appService.listAcademyNotices);

module.exports = {
  getDashboard,
  listAcademyNotices,
};
