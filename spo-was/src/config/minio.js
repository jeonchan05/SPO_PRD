const parseBool = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parsePort = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const minioEndpoint = String(process.env.MINIO_ENDPOINT || "").trim();
const minioPort = parsePort(process.env.MINIO_PORT, 9000);
const minioUseSSL = parseBool(process.env.MINIO_USE_SSL, false);
const minioAccessKey = String(process.env.MINIO_ACCESS_KEY || "").trim();
const minioSecretKey = String(process.env.MINIO_SECRET_KEY || "").trim();
const minioBucket = String(process.env.MINIO_BUCKET || "").trim();
const minioPublicBaseUrl = String(process.env.MINIO_PUBLIC_BASE_URL || "").trim() || null;
const defaultProfileImageUrl = String(
  process.env.DEFAULT_PROFILE_IMAGE_URL || "/default-profile-avatar.svg",
).trim();

const hasMinioConfig = Boolean(
  minioEndpoint && minioAccessKey && minioSecretKey && minioBucket,
);

module.exports = {
  minioEndpoint,
  minioPort,
  minioUseSSL,
  minioAccessKey,
  minioSecretKey,
  minioBucket,
  minioPublicBaseUrl,
  defaultProfileImageUrl,
  hasMinioConfig,
};
