import { z } from "zod";

export const createVoucherSchema = z
  .object({
    eventId: z.number().int().positive(),
    code: z
      .string()
      .trim()
      .min(3)
      .max(50)
      .transform((code) => code.toUpperCase()),
    discountValue: z.number().int().min(1).max(100),
    quota: z.number().int().positive(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

export const updateVoucherSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(50)
      .transform((code) => code.toUpperCase())
      .optional(),
    discountValue: z.number().int().min(1).max(100).optional(),
    quota: z.number().int().positive().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (data) =>
      data.startDate === undefined ||
      data.endDate === undefined ||
      data.endDate > data.startDate,
    {
      message: "End date must be after start date",
      path: ["endDate"],
    },
  );

export type CreateVoucherSchema = z.infer<typeof createVoucherSchema>;
export type UpdateVoucherSchema = z.infer<typeof updateVoucherSchema>;
