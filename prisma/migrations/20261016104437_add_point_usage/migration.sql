-- CreateTable
CREATE TABLE "point_usages" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "point_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_usages_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "point_usages" ADD CONSTRAINT "point_usages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_usages" ADD CONSTRAINT "point_usages_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
