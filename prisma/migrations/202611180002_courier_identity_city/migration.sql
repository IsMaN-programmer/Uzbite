-- Courier admission identity (passport + private face photo) and city-based free deliveries.
-- Couriers now choose a city of Uzbekistan instead of a Tashkent district.

-- AlterEnum
ALTER TYPE "UploadPurpose" ADD VALUE 'COURIER_FACE';

-- City becomes an explicit choice: couriers who never chose an area start without a city,
-- couriers who had a Tashkent district keep Tashkent. Districts are no longer used for couriers.
ALTER TABLE "CourierProfile" ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "city" DROP DEFAULT;
UPDATE "CourierProfile" SET "city" = NULL WHERE "serviceZone" IS NULL;

-- AlterTable
ALTER TABLE "CourierProfile" DROP COLUMN "serviceZone",
ADD COLUMN     "facePhotoId" TEXT,
ADD COLUMN     "passportNumber" TEXT,
ADD COLUMN     "passportSeries" TEXT;

ALTER TABLE "CourierProfile" ADD CONSTRAINT "CourierProfile_passport_format" CHECK (
  ("passportSeries" IS NULL AND "passportNumber" IS NULL)
  OR ("passportSeries" ~ '^[A-Z]{2}$' AND "passportNumber" ~ '^[0-9]{7}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierProfile_facePhotoId_key" ON "CourierProfile"("facePhotoId");

-- CreateIndex: one courier account per passport.
CREATE UNIQUE INDEX "CourierProfile_passportSeries_passportNumber_key" ON "CourierProfile"("passportSeries", "passportNumber");

-- AddForeignKey
ALTER TABLE "CourierProfile" ADD CONSTRAINT "CourierProfile_facePhotoId_fkey" FOREIGN KEY ("facePhotoId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
