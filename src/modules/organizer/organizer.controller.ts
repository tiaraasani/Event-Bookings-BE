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
