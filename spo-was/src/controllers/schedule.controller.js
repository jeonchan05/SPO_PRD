const { appService, createHandler } = require("./controller.helper");

const listPersonalSchedules = createHandler(appService.listPersonalSchedules);
const createPersonalSchedule = createHandler(appService.createPersonalSchedule);
const deletePersonalSchedule = createHandler(appService.deletePersonalSchedule);

module.exports = {
  listPersonalSchedules,
  createPersonalSchedule,
  deletePersonalSchedule,
};
