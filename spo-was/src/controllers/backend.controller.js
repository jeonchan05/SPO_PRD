const { pool } = require("../config/db");

const health = (_req, res) => {
  res.status(200).json({ service: "backend", status: "ok" });
};

const dbHealth = async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.status(200).json({ service: "backend", database: "ok", rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    res.status(500).json({ service: "backend", database: "error", message });
  }
};

const hello = (_req, res) => {
  res.status(200).json({
    service: "backend",
    message: "Hello from Express + Node.js backend",
  });
};

const authGuide = (_req, res) => {
  res.status(200).json({
    service: "backend",
    message: "SPO 인증 API",
    auth: "JWT(HttpOnly Cookie)",
    endpoints: {
      checkLoginId: "GET /auth/check-login-id?loginId={loginId}",
      signUp: "POST /auth/sign-up",
      signIn: "POST /auth/sign-in",
      me: "GET /auth/me",
      signOut: "POST /auth/sign-out",
      findId: "POST /auth/find-id",
      findPassword: "POST /auth/find-password",
    },
    app: {
      profile:
        "GET/PUT /app/users/me, PUT /app/users/me/profile-image, PUT /app/users/me/password, PUT /app/users/me/academy",
      academies: "GET /app/academies",
      studyRoomContext: "GET /app/study-room/context",
      studyRecruitments:
        "GET /app/study-recruitments, GET /app/study-recruitments/:recruitmentId, GET/PUT /app/study-recruitments/:recruitmentId/my-application, GET /app/study-recruitments/:recruitmentId/my-result, POST /app/study-recruitments/:recruitmentId/run-matching (operator)",
      studyGroups: "GET/POST /app/study-groups",
      studyGroupJoin: "POST /app/study-groups/:groupId/join",
      studySessions: "GET/POST /app/study-sessions",
      studySessionUpdate: "PUT /app/study-sessions/:sessionId",
      attendance: "GET/POST /app/attendance",
      attendanceSummary: "GET /app/attendance/summary",
      personalSchedules: "GET/POST /app/personal-schedules, DELETE /app/personal-schedules/:scheduleId",
      dashboard: "GET /app/dashboard",
    },
  });
};

module.exports = {
  health,
  dbHealth,
  hello,
  authGuide,
};
