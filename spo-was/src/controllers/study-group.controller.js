const { appService, createHandler } = require("./controller.helper");

const listStudyGroups = createHandler(appService.listStudyGroups);
const createStudyGroup = createHandler(appService.createStudyGroup);
const updateStudyGroup = createHandler(appService.updateStudyGroup);
const joinStudyGroup = createHandler(appService.joinStudyGroup);

module.exports = {
  listStudyGroups,
  createStudyGroup,
  updateStudyGroup,
  joinStudyGroup,
};
