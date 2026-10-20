import { z } from "zod";

export const createEventSchema = z
  .object({
    categoryId: z.coerce.number().int().positive(),
    name: z.string().min(3),
    description: z.string().optional(),
    city: z.string().min(2),
    type: z.enum(["VENUE", "ONLINE"]),
    slug: z.string().min(1),
    image: z.string().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    tickets: z
      .array(
        z.object({
          name: z.string().min(1),
          price: z.coerce.number().int().min(0),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

export const updateEventSchema = z
  .object({
    categoryId: z.coerce.number().int().positive().optional(),
    name: z.string().min(3).optional(),
    description: z.string().optional(),
    city: z.string().min(2).optional(),
    type: z.enum(["VENUE", "ONLINE"]).optional(),
    slug: z.string().min(1).optional(),
    image: z.string().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateEventSchema = z.infer<typeof updateEventSchema>;
export type CreateEventSchema = z.infer<typeof createEventSchema>;
