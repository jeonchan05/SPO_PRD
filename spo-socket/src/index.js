const crypto = require("crypto");
const http = require("http");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const Redis = require("ioredis");
const { Server } = require("socket.io");

const SOCKET_PORT = Number(process.env.SOCKET_PORT || process.env.PORT || 4100);
const SOCKET_IO_PATH = String(process.env.SOCKET_IO_PATH || "/api/socket.io").trim() || "/api/socket.io";
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
const MATERIAL_STATUS_CHANNEL = String(process.env.MATERIAL_STATUS_CHANNEL || "spo:material:status").trim();
const NOTIFICATION_CHANNEL = String(process.env.NOTIFICATION_CHANNEL || "spo:notification").trim();
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || "spo_access_token").trim() || "spo_access_token";
const JWT_ISSUER = String(process.env.JWT_ISSUER || "spo-was").trim();
const JWT_AUDIENCE = String(process.env.JWT_AUDIENCE || "spo-client").trim();
const CORS_ALLOW_ORIGIN = String(process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const isProduction = String(process.env.NODE_ENV || "")
  .trim()
  .toLowerCase() === "production";

const rawJwtSecret = String(process.env.JWT_SECRET || "").trim();
let jwtSecret = rawJwtSecret;
const dbHost = String(process.env.DB_HOST || "mysql").trim() || "mysql";
const dbPort = Number(process.env.DB_PORT || 3306);
const dbUser = String(process.env.DB_USER || "appuser").trim() || "appuser";
const dbPassword = String(process.env.DB_PASSWORD || "apppass").trim() || "apppass";
const dbName = String(process.env.DB_NAME || "appdb").trim() || "appdb";
const normalizeDbTimezone = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "+09:00";
  if (/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/.test(normalized)) return normalized;
  if (/^z$/i.test(normalized)) return "+00:00";
  return "+09:00";
};
const dbTimezone = normalizeDbTimezone(process.env.DB_TIMEZONE || "+09:00");

if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production.");
  }
  jwtSecret = crypto.randomBytes(48).toString("hex");
  console.warn("[socket] JWT_SECRET이 없어 개발용 임시 시크릿을 사용합니다.");
}

if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long.");
}

if (isProduction) {
  if (!process.env.DB_USER || !process.env.DB_PASSWORD || dbUser === "appuser" || dbPassword === "apppass") {
    throw new Error("Production DB credentials must be set via DB_USER/DB_PASSWORD and cannot use defaults.");
  }
}

const pool = mysql.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  timezone: dbTimezone,
  waitForConnections: true,
  connectionLimit: 10,
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = ?", [dbTimezone], (error) => {
    if (error) {
      console.error(`[socket-db] Failed to set session time_zone=${dbTimezone}: ${error.message}`);
    }
  });
});

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "not found" }));
});

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (CORS_ALLOW_ORIGIN.length === 0) {
    if (isProduction) return false;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  }
  return CORS_ALLOW_ORIGIN.includes(origin);
};

const io = new Server(server, {
  path: SOCKET_IO_PATH,
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS_NOT_ALLOWED"));
    },
    credentials: true,
  },
});

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseCookieHeader = (cookieHeader) => {
  if (!cookieHeader || typeof cookieHeader !== "string") return {};
  return cookieHeader.split(";").reduce((accumulator, token) => {
    const [rawKey, ...rest] = token.split("=");
    const key = String(rawKey || "").trim();
    if (!key) return accumulator;
    const value = rest.join("=").trim();
    accumulator[key] = decodeURIComponent(value || "");
    return accumulator;
  }, {});
};

const getBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const [scheme, token] = authorizationHeader.trim().split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
};

const extractSocketToken = (socket) => {
  const cookieToken = parseCookieHeader(socket.handshake?.headers?.cookie || "")[AUTH_COOKIE_NAME];
  const authToken = typeof socket.handshake?.auth?.token === "string" ? socket.handshake.auth.token : null;
  const bearerToken = getBearerToken(String(socket.handshake?.headers?.authorization || authToken || ""));
  return cookieToken || bearerToken || null;
};

const isFinalMaterialStatus = (status) => {
  const normalized = String(status || "").toLowerCase();
  return ["completed", "failed", "ai_unavailable"].includes(normalized);
};

const buildMaterialRoomName = (materialId) => `material:${materialId}`;
const buildUserRoomName = (userId) => `user:${userId}`;

const fetchMaterialForUser = async (materialId, userId) => {
  const [rows] = await pool.query(
    `SELECT id, status, error_message FROM uploaded_materials WHERE id = ? AND user_id = ? LIMIT 1`,
    [materialId, userId],
  );
  return rows[0] || null;
};

io.use((socket, next) => {
  try {
    const token = extractSocketToken(socket);
    if (!token) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    const payload = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const userId = toPositiveInt(payload?.sub);
    if (!userId) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    socket.data.auth = { userId };
    next();
  } catch (_error) {
    next(new Error("UNAUTHORIZED"));
  }
});

io.on("connection", (socket) => {
  const userId = toPositiveInt(socket.data?.auth?.userId);
  if (userId) {
    socket.join(buildUserRoomName(userId));
  }

  socket.on("material:subscribe", async (payload, ack) => {
    const materialId = toPositiveInt(payload?.materialId);
    const userId = toPositiveInt(socket.data?.auth?.userId);

    if (!materialId || !userId) {
      if (typeof ack === "function") {
        ack({ ok: false, message: "구독할 자료 ID를 확인해주세요." });
      }
      return;
    }

    try {
      const material = await fetchMaterialForUser(materialId, userId);
      if (!material) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "자료를 찾을 수 없습니다." });
        }
        return;
      }

      socket.join(buildMaterialRoomName(materialId));
      if (typeof ack === "function") {
        ack({
          ok: true,
          materialId,
          status: material.status,
          errorMessage: material.error_message || null,
        });
      }

      if (isFinalMaterialStatus(material.status)) {
        socket.emit("material:status", {
          materialId,
          userId,
          status: material.status,
          errorMessage: material.error_message || null,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "구독 처리 중 오류가 발생했습니다.";
      if (typeof ack === "function") {
        ack({ ok: false, message });
      }
    }
  });

  socket.on("material:unsubscribe", (payload) => {
    const materialId = toPositiveInt(payload?.materialId);
    if (!materialId) return;
    socket.leave(buildMaterialRoomName(materialId));
  });
});

let redisSubClient = null;

const initializeRedisSubscriber = async () => {
  if (!REDIS_URL) {
    console.warn("[socket] REDIS_URL이 비어 있어 realtime 이벤트 수신이 비활성화됩니다.");
    return;
  }

  const subscriber = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });

  subscriber.on("error", (error) => {
    console.error(`[socket] redis subscriber error: ${error.message}`);
  });

  await subscriber.subscribe(MATERIAL_STATUS_CHANNEL, NOTIFICATION_CHANNEL);
  subscriber.on("message", (channel, message) => {
    if (channel === MATERIAL_STATUS_CHANNEL) {
      try {
        const payload = JSON.parse(String(message || "{}"));
        const materialId = toPositiveInt(payload?.materialId);
        if (!materialId) return;
        io.to(buildMaterialRoomName(materialId)).emit("material:status", payload);
      } catch (_error) {
        // ignore malformed payload
      }
      return;
    }

    if (channel === NOTIFICATION_CHANNEL) {
      try {
        const payload = JSON.parse(String(message || "{}"));
        const userId = toPositiveInt(payload?.userId);
        if (!userId) return;
        io.to(buildUserRoomName(userId)).emit("notification:event", payload);
      } catch (_error) {
        // ignore malformed payload
      }
    }
  });

  redisSubClient = subscriber;
  console.log(`[socket] redis subscribed: ${MATERIAL_STATUS_CHANNEL}, ${NOTIFICATION_CHANNEL}`);
};

const start = async () => {
  await initializeRedisSubscriber();

  server.listen(SOCKET_PORT, () => {
    console.log(`[socket] Socket server listening on ${SOCKET_PORT} path=${SOCKET_IO_PATH}`);
  });
};

const shutdown = async (signal) => {
  try {
    await new Promise((resolve) => io.close(() => resolve()));
    if (redisSubClient) {
      await redisSubClient.quit().catch(() => {});
      redisSubClient = null;
    }
    await pool.end();
    await new Promise((resolve) => server.close(() => resolve()));
  } finally {
    console.log(`[socket] Graceful shutdown: ${signal}`);
    process.exit(0);
  }
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

start().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`[socket] failed to start: ${message}`);
  process.exit(1);
});
