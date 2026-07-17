-- Frozen offer snapshot on tenders: the offered rate/currency captured at send time
-- from Load.estimatedCost/costCurrency. The carrier-facing projection reads this snapshot,
-- so a later recompute of the load never changes an offer already sent (immutability).
ALTER TABLE "tenders" ADD COLUMN     "offeredAmount" DECIMAL(12,2);
ALTER TABLE "tenders" ADD COLUMN     "offeredCurrency" TEXT;
