const Redis = require("ioredis");

const NOTIFICATION_CHANNEL = String(process.env.NOTIFICATION_CHANNEL || "spo:notification").trim();
const REDIS_URL = String(process.env.REDIS_URL || "").trim();

let redisClient = null;
let redisInitPromise = null;
let redisUnavailableLogged = false;

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const ensureRedisClient = async () => {
  if (redisClient) return redisClient;
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    if (!REDIS_URL) {
      if (!redisUnavailableLogged) {
        console.warn("[notification-publisher] REDIS_URL이 설정되지 않아 알림 이벤트를 발행하지 않습니다.");
        redisUnavailableLogged = true;
      }
      return null;
    }

    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });

    client.on("error", (error) => {
      console.error(`[notification-publisher] redis error: ${error.message}`);
    });

    await client.ping();
    redisClient = client;
    return redisClient;
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[notification-publisher] redis init failed: ${message}`);
      return null;
    })
    .finally(() => {
      redisInitPromise = null;
    });

  return redisInitPromise;
};

const publishNotificationEvent = async (payload) => {
  const userId = toPositiveInt(payload?.userId);
  const eventType = String(payload?.eventType || "").trim().toLowerCase();
  if (!userId || !eventType) return;

  const redis = await ensureRedisClient();
  if (!redis) return;

  const messagePayload = {
    eventType,
    userId,
    notificationId: toPositiveInt(payload?.notificationId),
    updatedCount: Number.isFinite(Number(payload?.updatedCount))
      ? Math.max(0, Number.parseInt(String(payload.updatedCount), 10) || 0)
      : null,
    createdAt: new Date().toISOString(),
  };

  await redis.publish(NOTIFICATION_CHANNEL, JSON.stringify(messagePayload));
};

const closeNotificationPublisher = async () => {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = null;
  await client.quit().catch(() => {});
};

module.exports = {
  publishNotificationEvent,
  closeNotificationPublisher,
};
