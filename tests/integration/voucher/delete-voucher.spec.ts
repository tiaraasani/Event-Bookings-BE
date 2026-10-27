import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../../src/lib/prisma.js";
import { app } from "../../../src/app.js";
import {
  createCustomer,
  createEvent,
  createOrder,
  createOrganizer,
  createVoucher,
  signAccessToken,
  signExpiredToken,
} from "../../helpers/factories.js";

function deleteVoucher(voucherId: number | string, token?: string) {
  const req = request(app).delete(`/api/vouchers/${voucherId}`);

  if (token !== undefined) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req;
}

describe("DELETE /vouchers/:id", () => {
  it("should delete an unused voucher", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    const voucher = await createVoucher(event.id);

    const response = await deleteVoucher(voucher.id, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Voucher deleted successfully");
    expect(
      await prisma.voucher.findUnique({ where: { id: voucher.id } }),
    ).toBeNull();
  });

  it("should only delete the requested voucher", async () => {
    const { user, organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    const target = await createVoucher(event.id, { code: "TARGET" });
    const other = await createVoucher(event.id, { code: "OTHER" });

    const response = await deleteVoucher(target.id, signAccessToken(user));

    expect(response.status).toBe(200);
    expect(await prisma.voucher.count()).toBe(1);
    expect(
      await prisma.voucher.findUnique({ where: { id: other.id } }),
    ).not.toBeNull();
  });

  it("should return 400 when the voucher has already been used by an order", async () => {
    const { user, organization } = await createOrganizer();
    const { event, ticket } = await createEvent(organization.id);
    const voucher = await createVoucher(event.id);
    const customer = await createCustomer();
    await createOrder(customer.id, ticket.id, { voucherId: voucher.id });

    const response = await deleteVoucher(voucher.id, signAccessToken(user));

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "This voucher has already been used and cannot be deleted",
    );
    expect(
      await prisma.voucher.findUnique({ where: { id: voucher.id } }),
    ).not.toBeNull();
  });

  it("should return 404 when the voucher belongs to another organizer", async () => {
    const { organization } = await createOrganizer();
    const { event } = await createEvent(organization.id);
    const voucher = await createVoucher(event.id);
    const other = await createOrganizer({ organizationName: "Globex" });

    const response = await deleteVoucher(
      voucher.id,
      signAccessToken(other.user),
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Voucher not found");
    expect(
      await prisma.voucher.findUnique({ where: { id: voucher.id } }),
    ).not.toBeNull();
  });

  it("should return 404 when the voucher does not exist", async () => {
    const { user } = await createOrganizer();

    const response = await deleteVoucher(999_999, signAccessToken(user));

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Voucher not found");
  });

  it.each(["abc", "0", "-1"])(
    "should return 400 for an invalid voucher id (%s)",
    async (voucherId) => {
      const { user } = await createOrganizer();

      const response = await deleteVoucher(voucherId, signAccessToken(user));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid voucher ID");
    },
  );

  it("should return 403 when a customer tries to delete a voucher", async () => {
    const customer = await createCustomer();

    const response = await deleteVoucher(1, signAccessToken(customer));

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Only organizers can manage vouchers");
  });

  it("should return 401 when no token is provided", async () => {
    const response = await deleteVoucher(1);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token not provided");
  });

  it("should return 401 for an expired token", async () => {
    const { user } = await createOrganizer();

    const response = await deleteVoucher(1, signExpiredToken(user));

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Token expired");
  });
});
