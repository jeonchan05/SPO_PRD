const { appService, createHandler } = require("./controller.helper");

const searchAcademies = createHandler(appService.searchAcademies);
const registerMyAcademy = createHandler(appService.registerMyAcademy);

module.exports = {
  searchAcademies,
  registerMyAcademy,
};
