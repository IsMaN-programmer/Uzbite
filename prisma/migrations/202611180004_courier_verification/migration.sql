-- Support verification of couriers: REJECTED status, the reason and when the status last changed.
-- AlterEnum
ALTER TYPE "CourierApprovalStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "CourierProfile" ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "approvalChangedAt" TIMESTAMP(3);
