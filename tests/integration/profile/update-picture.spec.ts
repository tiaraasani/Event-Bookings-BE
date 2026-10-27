import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "../../../src/generated/prisma/enums.js";
import { prisma } from "../../../src/lib/prisma.js";

vi.mock("../../../src/lib/cloudinary.js", () => ({
  uploadImage: vi.fn(),
  removeImageByUrl: vi.fn(),
}));

import { app } from "../../../src/app.js";
import { removeImageByUrl, uploadImage } from "../../../src/lib/cloudinary.js";
import {
  PNG_BYTES,
  createCustomer,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

const OLD_PICTURE_URL = "https://res.cloudinary.com/demo/image/upload/old.png";
const NEW_PICTURE_URL = "https://res.cloudinary.com/demo/image/upload/new.png";

function updatePicture(token?: string) {
  const req = request(app).patch("/api/profile/picture");

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

function attachPicture(
  req: request.Test,
  overrides: { buffer?: Buffer; filename?: string; contentType?: string } = {},
) {
  return req.attach("picture", overrides.buffer ?? PNG_BYTES, {
    filename: overrides.filename ?? "avatar.png",
    contentType: overrides.contentType ?? "image/png",
  });
}

describe("PATCH /profile/picture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should upload the picture and save its url", async () => {
    const customer = await createCustomer();
    vi.mocked(uploadImage).mockResolvedValue({ secure_url: NEW_PICTURE_URL });

    const response = await attachPicture(updatePicture(signAccessToken(customer)));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Profile picture updated successfully",
      picture: NEW_PICTURE_URL,
    });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(updated.picture).toBe(NEW_PICTURE_URL);

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadImage).mock.calls[0][0]).toMatchObject({
      fieldname: "picture",
      originalname: "avatar.png",
      mimetype: "image/png",
    });
    expect(removeImageByUrl).not.toHaveBeenCalled();
  });

  it("should remove the previous picture from cloudinary when replacing it", async () => {
    const customer = await createCustomer({ picture: OLD_PICTURE_URL });
    vi.mocked(uploadImage).mockResolvedValue({ secure_url: NEW_PICTURE_URL });

    const response = await attachPicture(updatePicture(signAccessToken(customer)));

    expect(response.status).toBe(200);
    expect(removeImageByUrl).toHaveBeenCalledTimes(1);
    expect(removeImageByUrl).toHaveBeenCalledWith(OLD_PICTURE_URL);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(updated.picture).toBe(NEW_PICTURE_URL);
  });

  it("should return 400 when no file is attached", async () => {
    const customer = await createCustomer();

    const response = await updatePicture(signAccessToken(customer));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Picture file is required");
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("should return 400 when the file content is not a real image", async () => {
    const customer = await createCustomer();

    const response = await attachPicture(updatePicture(signAccessToken(customer)), {
      buffer: Buffer.from("this is not an image"),
      filename: "fake.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("File type is not allowed");
    expect(uploadImage).not.toHaveBeenCalled();

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(unchanged.picture).toBeNull();
  });

  it("should reject a file whose mimetype is not an image", async () => {
    const customer = await createCustomer();

    const response = await attachPicture(updatePicture(signAccessToken(customer)), {
      buffer: Buffer.from("hello"),
      filename: "notes.txt",
      contentType: "text/plain",
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Only image files are allowed");
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("should not save anything when the cloudinary upload fails", async () => {
    const customer = await createCustomer({ picture: OLD_PICTURE_URL });
    vi.mocked(uploadImage).mockRejectedValue(new Error("Cloudinary is down"));

    const response = await attachPicture(updatePicture(signAccessToken(customer)));

    expect(response.status).toBe(500);
    expect(removeImageByUrl).not.toHaveBeenCalled();

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(unchanged.picture).toBe(OLD_PICTURE_URL);
  });

  it("should return 404 when the user in the token no longer exists", async () => {
    const response = await attachPicture(
      updatePicture(signAccessToken({ id: 999_999, role: Role.CUSTOMER })),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("should return 401 when no token is provided", async () => {
    const response = await attachPicture(updatePicture());

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an invalid token", async () => {
    const response = await attachPicture(updatePicture("not-a-token"));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid token");
  });

  it("should return 401 for an expired token", async () => {
    const customer = await createCustomer();

    const response = await attachPicture(updatePicture(signExpiredToken(customer)));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
