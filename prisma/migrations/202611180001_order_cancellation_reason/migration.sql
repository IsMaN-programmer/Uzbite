-- Restaurant cancellations keep a reason the customer can see. Additive and nullable:
-- existing orders are not rewritten.
ALTER TABLE "Order" ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD CONSTRAINT "Order_cancellation_reason_length" CHECK ("cancellationReason" IS NULL OR char_length("cancellationReason") BETWEEN 3 AND 500);
