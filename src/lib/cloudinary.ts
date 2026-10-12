import axios from "axios";
import crypto from "crypto";
import FormData from "form-data";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
const apiKey = process.env.CLOUDINARY_API_KEY!;
const apiSecret = process.env.CLOUDINARY_API_SECRET!;

/**
 * Generate Cloudinary signature (SHA1)
 */
const generateSignature = (params: Record<string, string | number>): string => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(sortedParams + apiSecret)
    .digest("hex");
};

/**
 * Upload image using SIGNED request
 */
export const uploadImage = async (file: Express.Multer.File) => {
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = generateSignature({
    timestamp,
  });

  const formData = new FormData();

  formData.append("file", file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype,
  });

  formData.append("api_key", apiKey);
  formData.append("timestamp", timestamp.toString());
  formData.append("signature", signature);

const response = await axios.post(
  `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
  formData,
  {
    headers: formData.getHeaders(),
  },
);

  return response.data;
};

/**
 * Extract public_id from secure_url
 */
const extractPublicIdFromUrl = (url: string): string => {
  const withoutQuery = url.split("?")[0];
  const parts = withoutQuery.split("/");

  const uploadIndex = parts.findIndex((part) => part === "upload");
  const publicIdParts = parts.slice(uploadIndex + 2);

  return publicIdParts.join("/").replace(/\.[^/.]+$/, "");
};

/**
 * Delete image by secure_url
 */
export const removeImageByUrl = async (secureUrl: string) => {
  const publicId = extractPublicIdFromUrl(secureUrl);
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = generateSignature({
    public_id: publicId,
    timestamp,
  });

  const formData = new FormData();

  formData.append("public_id", publicId);
  formData.append("api_key", apiKey);
  formData.append("timestamp", timestamp.toString());
  formData.append("signature", signature);

const response = await axios.post(
  `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
  formData,
  {
    headers: formData.getHeaders(),
  },
);

  return response.data;
};