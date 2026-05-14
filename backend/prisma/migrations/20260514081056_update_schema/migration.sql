/*
  Warnings:

  - You are about to alter the column `price` on the `fills` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(18,8)`.
  - You are about to drop the column `buyer_id` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `seller_id` on the `orders` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(18,8)`.
  - Added the required column `updated_at` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_buyer_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_seller_id_fkey";

-- DropIndex
DROP INDEX "orders_buyer_id_idx";

-- DropIndex
DROP INDEX "orders_seller_id_idx";

-- AlterTable
ALTER TABLE "fills" ALTER COLUMN "price" SET DATA TYPE DECIMAL(18,8);

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "buyer_id",
DROP COLUMN "seller_id",
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "user_id" TEXT NOT NULL,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(18,8);

-- CreateTable
CREATE TABLE "last_trades" (
    "stock_id" TEXT NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "qty" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "last_trades_pkey" PRIMARY KEY ("stock_id")
);

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "orders_stock_id_side_status_price_idx" ON "orders"("stock_id", "side", "status", "price");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "last_trades" ADD CONSTRAINT "last_trades_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
