import { z } from "zod";

export const createReviewSchema = z.object({
  eventId: z.coerce.number().int().positive("Invalid event ID"),

  type: z.enum(["EVENT", "ORGANIZER"]),

  rating: z.coerce
    .number()
    .int()
    .min(1, "Rating must be at least 1 star")
    .max(5, "Rating cannot exceed 5 stars"),

  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(100, "Title cannot exceed 100 characters"),

  comment: z
    .string()
    .trim()
    .min(10, "Review must be at least 10 characters")
    .max(1000, "Review cannot exceed 1000 characters"),
});

export type CreateReviewSchema = z.infer<typeof createReviewSchema>;
