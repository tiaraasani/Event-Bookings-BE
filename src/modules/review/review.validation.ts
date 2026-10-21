import { z } from "zod";

export const createReviewSchema = z.object({
  orderId: z.number().int().positive(),

  type: z.enum(["EVENT", "ORGANIZER"]),

  rating: z.number().int().min(1).max(5),

  title: z.string().trim().min(1, "Title is required").max(100),

  comment: z.string().trim().min(1, "Comment is required").max(1000),
});

export type CreateReviewSchema = z.infer<typeof createReviewSchema>;
