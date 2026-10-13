import multer from "multer";

export const upload = () => {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB maximum
    },
    fileFilter: (_req, file, callback) => {
      if (file.mimetype.startsWith("image/")) {
        callback(null, true);
      } else {
        callback(new Error("Only image files are allowed"));
      }
    },
  });
};
