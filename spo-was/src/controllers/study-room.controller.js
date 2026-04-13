const { appService, createHandler } = require("./controller.helper");

const getStudyRoomContext = createHandler(appService.getStudyRoomContext);

module.exports = {
  getStudyRoomContext,
};
