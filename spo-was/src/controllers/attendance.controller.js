const { appService, createHandler } = require("./controller.helper");

const listAttendance = createHandler(appService.listAttendance);
const upsertAttendance = createHandler(appService.upsertAttendance);
const getAttendanceSummary = createHandler(appService.getAttendanceSummary);

module.exports = {
  listAttendance,
  upsertAttendance,
  getAttendanceSummary,
};
