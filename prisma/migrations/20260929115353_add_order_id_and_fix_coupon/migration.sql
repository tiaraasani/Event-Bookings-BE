/*
  Warnings:

  - You are about to alter the column `discount_value` on the `coupons` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - The `is_used` column on the `coupons` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "coupons" ALTER COLUMN "discount_value" SET DATA TYPE INTEGER,
DROP COLUMN "is_used",
ADD COLUMN     "is_used" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "points" ADD COLUMN     "order_id" INTEGER;
