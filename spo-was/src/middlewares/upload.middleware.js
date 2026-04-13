const multer = require("multer");

const MAX_PROFILE_IMAGE_SIZE_BYTES =
  Number.parseInt(String(process.env.MAX_PROFILE_IMAGE_SIZE_BYTES || ""), 10) || 5 * 1024 * 1024;
const MAX_MATERIAL_SIZE_BYTES =
  Number.parseInt(String(process.env.MAX_MATERIAL_SIZE_BYTES || ""), 10) || 50 * 1024 * 1024;

const ALLOWED_PROFILE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_MATERIAL_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const ALLOWED_MATERIAL_EXTENSIONS = new Set([".pdf", ".ppt", ".pptx"]);
const OLE_HEADER_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_HEADER_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

const getFileExtension = (originalName) => {
  const normalized = String(originalName || "").trim().toLowerCase();
  if (!normalized.includes(".")) return "";
  return normalized.slice(normalized.lastIndexOf("."));
};

const startsWithSignature = (buffer, signature, offset = 0) => {
  if (!Buffer.isBuffer(buffer) || !Buffer.isBuffer(signature)) return false;
  if (buffer.length < offset + signature.length) return false;
  return buffer.subarray(offset, offset + signature.length).equals(signature);
};

const hasZipHeader = (buffer) => ZIP_HEADER_SIGNATURES.some((signature) => startsWithSignature(buffer, signature));

const detectImageMimeBySignature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (startsWithSignature(buffer, Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (startsWithSignature(buffer, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (startsWithSignature(buffer, Buffer.from("GIF87a")) || startsWithSignature(buffer, Buffer.from("GIF89a"))) return "image/gif";
  if (startsWithSignature(buffer, Buffer.from("RIFF")) && startsWithSignature(buffer, Buffer.from("WEBP"), 8)) {
    return "image/webp";
  }
  return null;
};

const detectMaterialTypeBySignature = (buffer, extension) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (startsWithSignature(buffer, Buffer.from("%PDF-"))) return "pdf";
  if (startsWithSignature(buffer, OLE_HEADER_SIGNATURE)) return "ppt";
  if (hasZipHeader(buffer) && extension === ".pptx") return "pptx";
  return null;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROFILE_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PROFILE_IMAGE_MIME_TYPES.has(file.mimetype)) {
      const error = new Error("지원하지 않는 이미지 형식입니다. jpg, png, webp, gif만 가능합니다.");
      error.code = "INVALID_IMAGE_TYPE";
      return cb(error);
    }
    return cb(null, true);
  },
});

const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MATERIAL_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const extension = getFileExtension(file.originalname);
    const hasAllowedMime = ALLOWED_MATERIAL_MIME_TYPES.has(String(file.mimetype || "").toLowerCase());
    const hasAllowedExtension = ALLOWED_MATERIAL_EXTENSIONS.has(extension);

    if (!hasAllowedMime && !hasAllowedExtension) {
      const error = new Error("지원하지 않는 자료 형식입니다. pdf, ppt, pptx만 업로드할 수 있습니다.");
      error.code = "INVALID_MATERIAL_TYPE";
      return cb(error);
    }
    return cb(null, true);
  },
});

const uploadProfileImage = (fieldName = "profileImage") => (req, res, next) => {
  const uploader = upload.single(fieldName);
  uploader(req, res, (error) => {
    if (!error) {
      if (req.file) {
        const detectedMime = detectImageMimeBySignature(req.file.buffer);
        if (!detectedMime || !ALLOWED_PROFILE_IMAGE_MIME_TYPES.has(detectedMime)) {
          return res.status(400).json({ message: "이미지 파일 서명이 올바르지 않습니다." });
        }
      }
      return next();
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: `프로필 이미지는 ${Math.floor(MAX_PROFILE_IMAGE_SIZE_BYTES / (1024 * 1024))}MB 이하만 업로드할 수 있습니다.`,
      });
    }

    if (error.code === "INVALID_IMAGE_TYPE") {
      return res.status(400).json({ message: error.message });
    }

    return res.status(400).json({ message: "프로필 이미지 업로드 처리 중 오류가 발생했습니다." });
  });
};

const uploadMaterialFile = (fieldName = "material") => (req, res, next) => {
  const uploader = materialUpload.single(fieldName);
  uploader(req, res, (error) => {
    if (!error) {
      if (req.file) {
        const extension = getFileExtension(req.file.originalname);
        const hasAllowedExtension = ALLOWED_MATERIAL_EXTENSIONS.has(extension);
        const detectedType = detectMaterialTypeBySignature(req.file.buffer, extension);
        if (!hasAllowedExtension || !detectedType) {
          return res.status(400).json({
            message: "업로드 파일 검증에 실패했습니다. pdf, ppt, pptx 형식의 정상 파일만 업로드할 수 있습니다.",
          });
        }
      }
      return next();
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: `학습 자료는 ${Math.floor(MAX_MATERIAL_SIZE_BYTES / (1024 * 1024))}MB 이하만 업로드할 수 있습니다.`,
      });
    }

    if (error.code === "INVALID_MATERIAL_TYPE") {
      return res.status(400).json({ message: error.message });
    }

    return res.status(400).json({ message: "학습 자료 업로드 처리 중 오류가 발생했습니다." });
  });
};

module.exports = {
  uploadProfileImage,
  uploadMaterialFile,
};
