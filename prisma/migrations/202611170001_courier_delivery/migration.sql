-- Courier accounts, restaurant staff, affiliations and the delivery dispatch lifecycle.
-- Additive only: no existing table or row is dropped or rewritten.

-- CreateEnum
CREATE TYPE "CourierApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CourierWorkMode" AS ENUM ('RESTAURANT', 'FREELANCE');

-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "CourierInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('RESTAURANT_COURIER', 'UZBITE_COURIER');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_REQUESTED', 'SEARCHING', 'OFFERED', 'ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'TAKEN');

-- CreateEnum
CREATE TYPE "CashCollectionStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'COLLECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "CourierRewardStatus" AS ENUM ('NONE', 'ACCRUED', 'CONFIRMED', 'PAID');

-- CreateEnum
CREATE TYPE "DeliveryIssueType" AS ENUM ('CANCELLATION_REQUEST', 'HANDOFF_CODE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DeliveryIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "city" TEXT NOT NULL DEFAULT 'tashkent',
ADD COLUMN     "serviceZone" TEXT;

-- CreateTable
CREATE TABLE "RestaurantStaff" (
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantStaff_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CourierProfile" (
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "approvalStatus" "CourierApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "isTestAccount" BOOLEAN NOT NULL DEFAULT false,
    "workMode" "CourierWorkMode",
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "city" TEXT NOT NULL DEFAULT 'tashkent',
    "serviceZone" TEXT,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CourierInvitation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "CourierInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "courierId" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantCourierAffiliation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "invitationId" TEXT,
    "status" "AffiliationStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,

    CONSTRAINT "RestaurantCourierAffiliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "courierId" TEXT,
    "mode" "DeliveryMode",
    "status" "DeliveryStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reward" DECIMAL(14,2),
    "rewardStatus" "CourierRewardStatus" NOT NULL DEFAULT 'NONE',
    "pickupSnapshot" JSONB NOT NULL,
    "dropoffSnapshot" JSONB NOT NULL,
    "handoffCode" TEXT NOT NULL,
    "handoffAttempts" INTEGER NOT NULL DEFAULT 0,
    "cashAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashStatus" "CashCollectionStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "cashCollectedAt" TIMESTAMP(3),
    "cashCollectedById" TEXT,
    "cashSettledAt" TIMESTAMP(3),
    "searchStartedAt" TIMESTAMP(3),
    "searchExpiresAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedVia" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "rewardConfirmedAt" TIMESTAMP(3),
    "rewardPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOffer" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "mode" "DeliveryMode" NOT NULL,
    "status" "DeliveryOfferStatus" NOT NULL DEFAULT 'PENDING',
    "reward" DECIMAL(14,2),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus",
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "offerId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryIssue" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "type" "DeliveryIssueType" NOT NULL,
    "status" "DeliveryIssueStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestaurantStaff_restaurantId_idx" ON "RestaurantStaff"("restaurantId");

-- CreateIndex
CREATE INDEX "CourierProfile_workMode_isAvailable_approvalStatus_city_idx" ON "CourierProfile"("workMode", "isAvailable", "approvalStatus", "city");

-- CreateIndex
CREATE UNIQUE INDEX "CourierInvitation_codeHash_key" ON "CourierInvitation"("codeHash");

-- CreateIndex
CREATE INDEX "CourierInvitation_restaurantId_createdAt_idx" ON "CourierInvitation"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierInvitation_courierId_status_idx" ON "CourierInvitation"("courierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantCourierAffiliation_invitationId_key" ON "RestaurantCourierAffiliation"("invitationId");

-- CreateIndex
CREATE INDEX "RestaurantCourierAffiliation_courierId_status_idx" ON "RestaurantCourierAffiliation"("courierId", "status");

-- CreateIndex
CREATE INDEX "RestaurantCourierAffiliation_restaurantId_status_idx" ON "RestaurantCourierAffiliation"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_restaurantId_status_idx" ON "Delivery"("restaurantId", "status");

-- CreateIndex
CREATE INDEX "Delivery_courierId_status_idx" ON "Delivery"("courierId", "status");

-- CreateIndex
CREATE INDEX "Delivery_status_searchExpiresAt_idx" ON "Delivery"("status", "searchExpiresAt");

-- CreateIndex
CREATE INDEX "DeliveryOffer_courierId_status_expiresAt_idx" ON "DeliveryOffer"("courierId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryOffer_deliveryId_status_idx" ON "DeliveryOffer"("deliveryId", "status");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx" ON "DeliveryEvent"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryIssue_deliveryId_status_idx" ON "DeliveryIssue"("deliveryId", "status");

-- AddForeignKey
ALTER TABLE "RestaurantStaff" ADD CONSTRAINT "RestaurantStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantStaff" ADD CONSTRAINT "RestaurantStaff_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierProfile" ADD CONSTRAINT "CourierProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierInvitation" ADD CONSTRAINT "CourierInvitation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierInvitation" ADD CONSTRAINT "CourierInvitation_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantCourierAffiliation" ADD CONSTRAINT "RestaurantCourierAffiliation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantCourierAffiliation" ADD CONSTRAINT "RestaurantCourierAffiliation_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantCourierAffiliation" ADD CONSTRAINT "RestaurantCourierAffiliation_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "CourierInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A courier can hold at most one accepted, unfinished delivery.
CREATE UNIQUE INDEX "Delivery_one_active_per_courier"
ON "Delivery" ("courierId")
WHERE "courierId" IS NOT NULL AND "status" IN ('ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY');

-- An assigned delivery always has a courier; an unassigned one never does.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_courier_matches_status" CHECK (
  ("status" IN ('ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED') AND "courierId" IS NOT NULL)
  OR ("status" IN ('NOT_REQUESTED', 'SEARCHING', 'OFFERED') AND "courierId" IS NULL)
  OR "status" IN ('FAILED', 'CANCELLED')
);
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_money_valid" CHECK (("reward" IS NULL OR "reward" >= 0) AND "cashAmount" >= 0 AND "handoffAttempts" >= 0);
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_handoff_code_format" CHECK ("handoffCode" ~ '^[0-9]{4}$');

-- One open offer per courier per delivery, and at most one live accepted offer per delivery.
CREATE UNIQUE INDEX "DeliveryOffer_one_pending_per_courier"
ON "DeliveryOffer" ("deliveryId", "courierId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "DeliveryOffer_one_live_acceptance"
ON "DeliveryOffer" ("deliveryId") WHERE "status" = 'ACCEPTED' AND "releasedAt" IS NULL;
ALTER TABLE "DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_reward_valid" CHECK ("reward" IS NULL OR "reward" >= 0);

-- A restaurant/courier pair has at most one active affiliation.
CREATE UNIQUE INDEX "RestaurantCourierAffiliation_one_active"
ON "RestaurantCourierAffiliation" ("restaurantId", "courierId") WHERE "status" = 'ACTIVE';

-- Only one open issue of each kind per delivery.
CREATE UNIQUE INDEX "DeliveryIssue_one_open_per_type"
ON "DeliveryIssue" ("deliveryId", "type") WHERE "status" = 'OPEN';

ALTER TABLE "CourierProfile" ADD CONSTRAINT "CourierProfile_onboarding_step_valid" CHECK ("onboardingStep" BETWEEN 1 AND 5);
