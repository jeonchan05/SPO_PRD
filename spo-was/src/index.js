const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("path");
const backendRouter = require("./routes/backend.router");
const { closePool } = require("./config/db");
const { closeTenantPools } = require("./modules/common/tenant-db");
const { requestLogger } = require("./middlewares/logger.middleware");
const { closeMaterialPublisher } = require("./realtime/material-publisher");
const { closeNotificationPublisher } = require("./realtime/notification-publisher");

const app = express();
const port = Number(process.env.PORT || 4000);
const bodyLimit = String(process.env.BODY_PARSER_LIMIT || "5mb").trim() || "5mb";
const allowedOrigins = String(process.env.CORS_ALLOW_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
};

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.set("etag", false);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
app.use(cookieParser());
app.use(requestLogger);
app.use(
  "/uploads",
  express.static(path.resolve(process.env.LOCAL_UPLOAD_ROOT || "uploads"), {
    dotfiles: "deny",
    index: false,
    maxAge: "1d",
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    },
  }),
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  const isSameOrigin = Boolean(origin) && origin === requestOrigin;

  if (origin && !isSameOrigin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ message: "허용되지 않은 Origin입니다." });
  }

  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
  }

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-id, Cookie",
  );
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use("/", backendRouter);

const server = app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});

const shutdown = async (signal) => {
  try {
    await closeMaterialPublisher();
    await closeNotificationPublisher();
    await closeTenantPools();
    await closePool();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  } finally {
    console.log(`Graceful shutdown: ${signal}`);
    process.exit(0);
  }
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
