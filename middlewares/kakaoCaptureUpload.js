import multer from "multer";

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const storage = multer.memoryStorage();

export const kakaoCaptureUpload = multer({
  storage,
  limits: {
    files: Number(process.env.MAX_KAKAO_CAPTURE_IMAGES || 6),
    fileSize: Number(process.env.MAX_KAKAO_CAPTURE_FILE_SIZE_BYTES || 8 * 1024 * 1024),
  },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_IMAGE_TYPE"));
    }

    return cb(null, true);
  },
});
