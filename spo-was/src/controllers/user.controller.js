const { appService, createHandler } = require("./controller.helper");

const getMyProfile = createHandler(appService.getMyProfile);
const updateMyProfile = createHandler(appService.updateMyProfile);
const updateMyProfileImage = createHandler(appService.updateMyProfileImage);
const updateMyPassword = createHandler(appService.updateMyPassword);

module.exports = {
  getMyProfile,
  updateMyProfile,
  updateMyProfileImage,
  updateMyPassword,
};
