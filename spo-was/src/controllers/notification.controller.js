const notificationService = require("../services/notification.service");
const { createHandler } = require("./controller.helper");

const listMyNotifications = createHandler(notificationService.listMyNotifications, {
  errorMessage: "알림 처리 중 오류가 발생했습니다.",
});
const markNotificationRead = createHandler(notificationService.markNotificationRead, {
  errorMessage: "알림 처리 중 오류가 발생했습니다.",
});
const markAllNotificationsRead = createHandler(notificationService.markAllNotificationsRead, {
  errorMessage: "알림 처리 중 오류가 발생했습니다.",
});

module.exports = {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
