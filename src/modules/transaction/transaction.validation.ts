import { z } from "zod";

export const createTransactionSchema = z.object({
  ticketId: z.number().int().positive(),
  quantity: z.number().int().positive().max(10),
  pointsToUse: z.number().int().min(0).default(0),
});

export type CreateTransactionSchema = z.infer<typeof createTransactionSchema>;
