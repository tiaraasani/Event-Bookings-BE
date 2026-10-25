import * as organizerService from "./organizer.service";
import { Request, Response } from "express";

export async function getTransactions(req: Request, res: Response) {
  const result = await organizerService.getTransactions(req.user!.id);
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
  );
  res.status(200).json(result);
}

export async function getMyOrganization(req: Request, res: Response) {
  const result = await organizerService.getMyOrganization(req.user!.id);
  res.status(200).json(result);
}
