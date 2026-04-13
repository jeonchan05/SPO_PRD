const { appService, createHandler } = require("./controller.helper");

const listRewardContext = createHandler(appService.listRewardContext);
const spinReward = createHandler(appService.spinReward);

module.exports = {
  listRewardContext,
  spinReward,
};
