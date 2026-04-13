const express = require("express");
const userController = require("../controllers/user.controller");
const academyController = require("../controllers/academy.controller");
const studyRoomController = require("../controllers/study-room.controller");
const studyRecruitmentController = require("../controllers/study-recruitment.controller");
const friendshipController = require("../controllers/friendship.controller");
const studyGroupController = require("../controllers/study-group.controller");
const studySessionController = require("../controllers/study-session.controller");
const attendanceController = require("../controllers/attendance.controller");
const scheduleController = require("../controllers/schedule.controller");
const dashboardController = require("../controllers/dashboard.controller");
const materialController = require("../controllers/material.controller");
const rewardController = require("../controllers/reward.controller");
const academyManagementController = require("../controllers/academy-management.controller");
const notificationController = require("../controllers/notification.controller");
const { requireAuth, requireOperator } = require("../middlewares/auth.middleware");
const { uploadProfileImage, uploadMaterialFile } = require("../middlewares/upload.middleware");

const router = express.Router();

router.use(requireAuth);

router.get("/users/me", userController.getMyProfile);
router.put("/users/me", userController.updateMyProfile);
router.put("/users/me/profile-image", uploadProfileImage("profileImage"), userController.updateMyProfileImage);
router.put("/users/me/password", userController.updateMyPassword);
router.put("/users/me/academy", academyController.registerMyAcademy);
router.get("/academies", academyController.searchAcademies);
router.get("/study-room/context", studyRoomController.getStudyRoomContext);
router.get("/study-recruitments", studyRecruitmentController.listStudyRecruitments);
router.get("/study-recruitments/:recruitmentId", studyRecruitmentController.getStudyRecruitmentById);
router.get(
  "/study-recruitments/:recruitmentId/applicants",
  requireOperator,
  studyRecruitmentController.getStudyRecruitmentApplicants,
);
router.get(
  "/study-recruitments/:recruitmentId/my-application",
  studyRecruitmentController.getMyStudyRecruitmentApplication,
);
router.put(
  "/study-recruitments/:recruitmentId/my-application",
  studyRecruitmentController.upsertMyStudyRecruitmentApplication,
);
router.post(
  "/study-recruitments/:recruitmentId/run-matching",
  requireOperator,
  studyRecruitmentController.runStudyRecruitmentMatching,
);
router.post(
  "/study-recruitments/:recruitmentId/preview-ai-matching",
  requireOperator,
  studyRecruitmentController.previewStudyRecruitmentAiMatching,
);
router.post(
  "/study-recruitments/:recruitmentId/run-ai-matching",
  requireOperator,
  studyRecruitmentController.runStudyRecruitmentAiMatching,
);
router.post(
  "/study-recruitments/:recruitmentId/run-manual-matching",
  requireOperator,
  studyRecruitmentController.runStudyRecruitmentManualMatching,
);
router.get("/study-recruitments/:recruitmentId/my-result", studyRecruitmentController.getMyStudyRecruitmentResult);
router.get("/academy/students", requireOperator, friendshipController.listAcademyStudents);
router.get("/friends", friendshipController.listFriends);
router.get("/friends/requests", friendshipController.listFriendRequests);
router.post("/friends/requests", friendshipController.createFriendRequest);
router.patch("/friends/requests/:requestId", friendshipController.respondToFriendRequest);
router.delete("/friends/:friendUserId", friendshipController.removeFriend);

router.get("/study-groups", studyGroupController.listStudyGroups);
router.post("/study-groups", studyGroupController.createStudyGroup);
router.put("/study-groups/:groupId", studyGroupController.updateStudyGroup);
router.post("/study-groups/:groupId/join", studyGroupController.joinStudyGroup);

router.get("/study-sessions", studySessionController.listStudySessions);
router.post("/study-sessions", studySessionController.createStudySession);
router.put("/study-sessions/:sessionId", studySessionController.updateStudySession);
router.post(
  "/study-sessions/content-image",
  uploadProfileImage("contentImage"),
  studySessionController.uploadStudySessionContentImage,
);

router.get("/attendance", attendanceController.listAttendance);
router.post("/attendance", attendanceController.upsertAttendance);
router.get("/attendance/summary", attendanceController.getAttendanceSummary);
router.get("/personal-schedules", scheduleController.listPersonalSchedules);
router.post("/personal-schedules", scheduleController.createPersonalSchedule);
router.delete("/personal-schedules/:scheduleId", scheduleController.deletePersonalSchedule);

router.get("/rewards", rewardController.listRewardContext);
router.post("/rewards/spin", rewardController.spinReward);

router.get("/dashboard", dashboardController.getDashboard);
router.get("/academy-notices", dashboardController.listAcademyNotices);
router.get("/notifications", notificationController.listMyNotifications);
router.patch("/notifications/:notificationId/read", notificationController.markNotificationRead);
router.post("/notifications/read-all", notificationController.markAllNotificationsRead);

router.get("/academy-management", requireOperator, academyManagementController.listAcademyManagementContext);
router.post(
  "/academy-management/study-setup",
  requireOperator,
  academyManagementController.createAcademyStudySetup,
);
router.post(
  "/academy-management/study-recruitments",
  requireOperator,
  academyManagementController.createStudyRecruitment,
);
router.patch(
  "/academy-management/study-recruitments/:recruitmentId",
  requireOperator,
  academyManagementController.updateStudyRecruitment,
);
router.delete(
  "/academy-management/study-recruitments/:recruitmentId",
  requireOperator,
  academyManagementController.deleteStudyRecruitment,
);
router.post(
  "/academy-management/notices",
  requireOperator,
  uploadProfileImage("noticeImage"),
  academyManagementController.createAcademyNotice,
);
router.patch(
  "/academy-management/notices/:noticeId",
  requireOperator,
  uploadProfileImage("noticeImage"),
  academyManagementController.updateAcademyNotice,
);
router.delete(
  "/academy-management/notices/:noticeId",
  requireOperator,
  academyManagementController.deleteAcademyNotice,
);
router.put(
  "/academy-management/reward-settings",
  requireOperator,
  academyManagementController.upsertAcademyRewardSettings,
);

router.get("/materials", materialController.listMaterials);
router.post("/materials", uploadMaterialFile("material"), materialController.uploadMaterial);
router.get("/materials/:materialId", materialController.getMaterialDetail);
router.post("/materials/:materialId/analyze", materialController.analyzeMaterial);

module.exports = router;
