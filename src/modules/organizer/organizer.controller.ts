import * as organizerService from "./organizer.service";
import { Request, Response } from "express";
import { PaymentStatus } from "../../generated/prisma/client";

export async function getTransactions(req: Request, res: Response) {
  const query = {
    page: parseInt(req.query.page as string) || 1,
    take: parseInt(req.query.take as string) || 10,
    sortOrder: (req.query.sortOrder as string) || "desc",
    sortBy: (req.query.sortBy as string) || "createdAt",
    search: (req.query.search as string) || "",
    status: Object.values(PaymentStatus).includes(
      req.query.status as PaymentStatus,
    )
      ? (req.query.status as PaymentStatus)
      : undefined,
    eventId:
      Number(req.query.eventId) > 0 ? Number(req.query.eventId) : undefined,
  };
  const result = await organizerService.getTransactions(req.user!.id, query);
  res.status(200).json(result);
}

export async function acceptTransaction(req: Request, res: Response) {
  const result = await organizerService.acceptTransaction(
    req.user!.id,
    Number(req.params.id),
  );
  res.status(200).json(result);
}

export async function rejectTransaction(req: Request, res: Response) {
  const result = await organizerService.rejectTransaction(
    req.user!.id,
    Number(req.params.id),
  );
  res.status(200).json(result);
}
export async function getStatistics(req: Request, res: Response) {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;

  const result = await organizerService.getStatistics(
    req.user!.id,
    year,
    month,
  );
  res.status(200).json(result);
}

export async function getEventAttendees(req: Request, res: Response) {
  const result = await organizerService.getEventAttendees(
    req.user!.id,
    Number(req.params.id),
    {
      page: parseInt(req.query.page as string) || 1,
      take: parseInt(req.query.take as string) || 10,
    },
  );
  res.status(200).json(result);
}

export async function getMyOrganization(req: Request, res: Response) {
  const result = await organizerService.getMyOrganization(req.user!.id);
  res.status(200).json(result);
}
