const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const Minio = require("minio");
const {
  minioEndpoint,
  minioPort,
  minioUseSSL,
  minioAccessKey,
  minioSecretKey,
  minioBucket,
  minioPublicBaseUrl,
  hasMinioConfig,
} = require("../../config/minio");

const LOCAL_UPLOAD_ROOT = path.resolve(process.env.LOCAL_UPLOAD_ROOT || "uploads");
const PROFILE_IMAGE_LOCAL_DIR = path.resolve(
  process.env.PROFILE_IMAGE_LOCAL_DIR || path.join(LOCAL_UPLOAD_ROOT, "profiles"),
);
const PROFILE_IMAGE_LOCAL_PUBLIC_BASE_URL = String(process.env.PROFILE_IMAGE_LOCAL_PUBLIC_BASE_URL || "/api/uploads/profiles")
  .trim()
  .replace(/\/+$/, "");
const PROFILE_IMAGE_STORAGE_MODE = String(process.env.PROFILE_IMAGE_STORAGE_MODE || "auto")
  .trim()
  .toLowerCase();

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

let minioClient = null;
let bucketReady = false;
let localDirReady = false;

const getClient = () => {
  if (!hasMinioConfig) return null;

  if (!minioClient) {
    minioClient = new Minio.Client({
      endPoint: minioEndpoint,
      port: minioPort,
      useSSL: minioUseSSL,
      accessKey: minioAccessKey,
      secretKey: minioSecretKey,
    });
  }

  return minioClient;
};

const ensureBucket = async () => {
  const client = getClient();
  if (!client) {
    const error = new Error("MINIO_NOT_CONFIGURED");
    error.code = "MINIO_NOT_CONFIGURED";
    throw error;
  }

  if (bucketReady) return;

  const exists = await client.bucketExists(minioBucket);
  if (!exists) {
    await client.makeBucket(minioBucket);
  }

  bucketReady = true;
};

const ensureLocalDirectory = async () => {
  if (localDirReady) return;
  await fs.mkdir(PROFILE_IMAGE_LOCAL_DIR, { recursive: true });
  localDirReady = true;
};

const encodeObjectPath = (objectName) =>
  objectName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

const buildObjectPublicUrl = (objectName) => {
  const encodedPath = encodeObjectPath(objectName);
  if (minioPublicBaseUrl) {
    return `${minioPublicBaseUrl.replace(/\/+$/, "")}/${encodedPath}`;
  }

  const protocol = minioUseSSL ? "https" : "http";
  return `${protocol}://${minioEndpoint}:${minioPort}/${minioBucket}/${encodedPath}`;
};

const resolveExtension = (file) => {
  const byMime = MIME_TO_EXT[file.mimetype];
  if (byMime) return byMime;

  const fromName = path.extname(file.originalname || "").toLowerCase();
  if (fromName && fromName.length <= 8) return fromName;
  return ".bin";
};

const buildLocalPublicUrl = (relativePath) => {
  const safeBase = PROFILE_IMAGE_LOCAL_PUBLIC_BASE_URL || "/api/uploads/profiles";
  return `${safeBase}/${encodeObjectPath(relativePath)}`;
};

const saveProfileImageLocally = async (file) => {
  await ensureLocalDirectory();

  const extension = resolveExtension(file);
  const dateSegment = new Date().toISOString().slice(0, 10);
  const relativePath = `${dateSegment}/${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(PROFILE_IMAGE_LOCAL_DIR, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, file.buffer);

  return {
    objectName: `local/${relativePath}`,
    publicUrl: buildLocalPublicUrl(relativePath),
  };
};

const uploadToMinio = async (file) => {
  await ensureBucket();

  const client = getClient();
  const extension = resolveExtension(file);
  const objectName = `profiles/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;

  await client.putObject(minioBucket, objectName, file.buffer, file.size, {
    "Content-Type": file.mimetype,
  });

  return {
    objectName,
    publicUrl: buildObjectPublicUrl(objectName),
  };
};

const isMinioPreferred = () => PROFILE_IMAGE_STORAGE_MODE === "minio";
const isLocalOnly = () => PROFILE_IMAGE_STORAGE_MODE === "local";
const isLocalObjectName = (value) => String(value || "").startsWith("local/");

const removeLocalProfileImage = async (objectName) => {
  const relativePath = String(objectName || "").slice("local/".length);
  if (!relativePath) return;

  const absolutePath = path.resolve(PROFILE_IMAGE_LOCAL_DIR, relativePath);
  const expectedPrefix = `${PROFILE_IMAGE_LOCAL_DIR}${path.sep}`;
  if (absolutePath !== PROFILE_IMAGE_LOCAL_DIR && !absolutePath.startsWith(expectedPrefix)) {
    return;
  }

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
};

const uploadProfileImage = async (file) => {
  if (isLocalOnly()) {
    return saveProfileImageLocally(file);
  }

  const shouldTryMinio = isMinioPreferred() || hasMinioConfig;
  if (shouldTryMinio) {
    try {
      return await uploadToMinio(file);
    } catch (error) {
      if (isMinioPreferred() || (error && error.code === "MINIO_NOT_CONFIGURED")) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[profile-image] minio upload failed, fallback to local storage: ${message}`);
    }
  }

  return saveProfileImageLocally(file);
};

const removeProfileImage = async (objectName) => {
  if (!objectName) return;

  if (isLocalObjectName(objectName)) {
    await removeLocalProfileImage(objectName);
    return;
  }

  if (!hasMinioConfig) return;
  const client = getClient();
  if (!client) return;

  try {
    await client.removeObject(minioBucket, objectName);
  } catch (_error) {
    // best-effort cleanup only
  }
};

module.exports = {
  uploadProfileImage,
  removeProfileImage,
};
