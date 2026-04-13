const { appService, createHandler } = require("./controller.helper");

const listAcademyStudents = createHandler(appService.listAcademyStudents);
const listFriends = createHandler(appService.listFriends);
const listFriendRequests = createHandler(appService.listFriendRequests);
const createFriendRequest = createHandler(appService.createFriendRequest);
const respondToFriendRequest = createHandler(appService.respondToFriendRequest);
const removeFriend = createHandler(appService.removeFriend);

module.exports = {
  listAcademyStudents,
  listFriends,
  listFriendRequests,
  createFriendRequest,
  respondToFriendRequest,
  removeFriend,
};
