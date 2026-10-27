import { NextFunction, Request, Response } from "express";
import fileType from "file-type";
import multer from "multer";
import { ApiError } from "../utils/api-error";

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

export const fileFilter = (allowedTypes: fileType.MimeType[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined;

      for (const fieldname in files) {
        const fileArray = files[fieldname];

        for (const file of fileArray) {
          const type = await fileType.fromBuffer(file.buffer);

          if (!type || !allowedTypes.includes(type.mime)) {
            throw new ApiError("File type is not allowed", 400);
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
