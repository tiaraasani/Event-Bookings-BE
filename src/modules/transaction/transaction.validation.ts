import { z } from "zod";

export const createTransactionSchema = z.object({
  ticketId: z.number().int().positive(),
  quantity: z.number().int().positive().max(10),
});

export type CreateTransactionSchema = z.infer<typeof createTransactionSchema>;
