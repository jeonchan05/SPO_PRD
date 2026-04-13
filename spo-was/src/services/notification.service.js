const { pool } = require("../config/db");
const { fetchUserById } = require("../modules/common/user.repository");
const { toPositiveInt } = require("../modules/common/value.utils");
const { publishNotificationEvent } = require("../realtime/notification-publisher");

let notificationSchemaReady = false;

const ensureNotificationSchema = async () => {
  if (notificationSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type VARCHAR(60) NOT NULL DEFAULT 'general',
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      link_url VARCHAR(500) NULL,
      payload_json LONGTEXT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_notifications_user_created (user_id, created_at),
      KEY idx_user_notifications_user_unread (user_id, is_read, created_at),
      CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  notificationSchemaReady = true;
};

const resolveUser = async (req) => {
  const userId = toPositiveInt(req.auth?.userId);
  if (!userId) {
    return { error: { status: 401, body: { message: "로그인이 필요합니다." } } };
  }

  const user = await fetchUserById(pool, userId);
  if (!user) {
    return { error: { status: 404, body: { message: "사용자 정보를 찾을 수 없습니다." } } };
  }

  if (String(user.status || "") !== "active") {
    return { error: { status: 403, body: { message: "비활성화된 계정입니다." } } };
  }

  return { user };
};

const mapNotificationRow = (row) => ({
  id: Number(row.id),
  type: String(row.type || "general"),
  title: String(row.title || ""),
  message: String(row.message || ""),
  linkUrl: row.link_url ? String(row.link_url) : null,
  isRead: Boolean(row.is_read),
  createdAt: row.created_at,
  readAt: row.read_at || null,
});

const publishNotificationEventSafely = async (payload) => {
  try {
    await publishNotificationEvent(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[notification] realtime publish failed: ${message}`);
  }
};

const listMyNotifications = async (req) => {
  await ensureNotificationSchema();

  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  const limit = Math.max(1, Math.min(5, Number.parseInt(String(req.query.limit || "5"), 10) || 5));

  const [rows] = await pool.query(
    `SELECT id, type, title, message, link_url, is_read, created_at, read_at
     FROM user_notifications
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [currentUser.user.id, limit],
  );

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS unreadCount
     FROM user_notifications
     WHERE user_id = ? AND is_read = 0`,
    [currentUser.user.id],
  );

  return {
    status: 200,
    body: {
      notifications: rows.map(mapNotificationRow),
      unreadCount: Number(countRows?.[0]?.unreadCount || 0),
    },
  };
};

const markNotificationRead = async (req) => {
  await ensureNotificationSchema();

  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  const notificationId = toPositiveInt(req.params.notificationId);
  if (!notificationId) {
    return { status: 400, body: { message: "알림 ID를 확인해주세요." } };
  }

  const [result] = await pool.query(
    `UPDATE user_notifications
     SET is_read = 1, read_at = IFNULL(read_at, NOW())
     WHERE id = ? AND user_id = ?`,
    [notificationId, currentUser.user.id],
  );

  if (!result.affectedRows) {
    return { status: 404, body: { message: "알림을 찾을 수 없습니다." } };
  }

  await publishNotificationEventSafely({
    eventType: "read",
    userId: currentUser.user.id,
    notificationId,
  });

  return {
    status: 200,
    body: {
      message: "알림을 읽음 처리했습니다.",
      notificationId,
    },
  };
};

const markAllNotificationsRead = async (req) => {
  await ensureNotificationSchema();

  const currentUser = await resolveUser(req);
  if (currentUser.error) return currentUser.error;

  const [result] = await pool.query(
    `UPDATE user_notifications
     SET is_read = 1, read_at = IFNULL(read_at, NOW())
     WHERE user_id = ? AND is_read = 0`,
    [currentUser.user.id],
  );

  await publishNotificationEventSafely({
    eventType: "read-all",
    userId: currentUser.user.id,
    updatedCount: Number(result.affectedRows || 0),
  });

  return {
    status: 200,
    body: {
      message: "모든 알림을 읽음 처리했습니다.",
      updatedCount: Number(result.affectedRows || 0),
    },
  };
};

const createUserNotification = async ({
  userId,
  type = "general",
  title,
  message,
  linkUrl = null,
  payload = null,
}) => {
  await ensureNotificationSchema();

  const normalizedUserId = toPositiveInt(userId);
  const normalizedTitle = String(title || "").trim().slice(0, 180);
  const normalizedMessage = String(message || "").trim().slice(0, 2000);

  if (!normalizedUserId || !normalizedTitle || !normalizedMessage) {
    return null;
  }

  const normalizedType = String(type || "general").trim().slice(0, 60) || "general";
  const normalizedLinkUrl = String(linkUrl || "").trim().slice(0, 500) || null;
  const payloadJson = payload ? JSON.stringify(payload) : null;

  const [result] = await pool.query(
    `INSERT INTO user_notifications (user_id, type, title, message, link_url, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [normalizedUserId, normalizedType, normalizedTitle, normalizedMessage, normalizedLinkUrl, payloadJson],
  );
  const notificationId = Number(result.insertId || 0) || null;
  if (notificationId) {
    await publishNotificationEventSafely({
      eventType: "created",
      userId: normalizedUserId,
      notificationId,
    });
  }

  return notificationId;
};

module.exports = {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createUserNotification,
};
