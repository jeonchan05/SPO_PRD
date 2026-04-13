const Redis = require("ioredis");

const MATERIAL_STATUS_CHANNEL = String(process.env.MATERIAL_STATUS_CHANNEL || "spo:material:status").trim();
const REDIS_URL = String(process.env.REDIS_URL || "").trim();

let redisClient = null;
let redisInitPromise = null;
let redisUnavailableLogged = false;

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toNonNegativeInt = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const ensureRedisClient = async () => {
  if (redisClient) return redisClient;
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    if (!REDIS_URL) {
      if (!redisUnavailableLogged) {
        console.warn("[material-publisher] REDIS_URL이 설정되지 않아 소켓 상태 이벤트를 발행하지 않습니다.");
        redisUnavailableLogged = true;
      }
      return null;
    }

    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });

    client.on("error", (error) => {
      console.error(`[material-publisher] redis error: ${error.message}`);
    });

    await client.ping();
    redisClient = client;
    return redisClient;
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[material-publisher] redis init failed: ${message}`);
      return null;
    })
    .finally(() => {
      redisInitPromise = null;
    });

  return redisInitPromise;
};

const publishMaterialStatus = async (payload) => {
  const materialId = toPositiveInt(payload?.materialId);
  const userId = toPositiveInt(payload?.userId);
  const status = String(payload?.status || "").toLowerCase();
  if (!materialId || !userId || !status) return;

  const redis = await ensureRedisClient();
  if (!redis) return;

  const messagePayload = {
    materialId,
    userId,
    status,
    errorMessage: payload?.errorMessage ? String(payload.errorMessage) : null,
    progressPercent: (() => {
      const parsed = Number.parseInt(String(payload?.progressPercent || ""), 10);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(100, parsed));
    })(),
    stage: payload?.stage ? String(payload.stage) : null,
    message: payload?.message ? String(payload.message) : null,
    processedPages: toNonNegativeInt(payload?.processedPages),
    totalPages: toPositiveInt(payload?.totalPages),
    updatedAt: payload?.updatedAt || new Date().toISOString(),
  };

  await redis.publish(MATERIAL_STATUS_CHANNEL, JSON.stringify(messagePayload));
};

const closeMaterialPublisher = async () => {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = null;
  await client.quit().catch(() => {});
};

module.exports = {
  publishMaterialStatus,
  closeMaterialPublisher,
};
