-- Courier's last reported position (sent by the open app) for orders within 5 km of the restaurant.
-- AlterTable
ALTER TABLE "CourierProfile" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "locationAt" TIMESTAMP(3);
