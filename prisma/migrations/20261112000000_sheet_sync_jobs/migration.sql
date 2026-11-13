CREATE TABLE "SheetSyncJob" (
  "sourceKey" TEXT NOT NULL,
  "bucket" INTEGER NOT NULL CHECK ("bucket" >= 0),
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "lastSuccessfulAt" TIMESTAMPTZ(3),
  "lastSuccessDurationMs" INTEGER,
  "lastSuccessProcessedRows" INTEGER,
  "lastSuccessBucketCount" INTEGER,
  PRIMARY KEY ("sourceKey", "bucket"),
  CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL))
);

CREATE TABLE "SheetSyncAttempt" (
  "id" TEXT PRIMARY KEY,
  "sourceKey" TEXT NOT NULL,
  "bucket" INTEGER NOT NULL CHECK ("bucket" >= 0),
  "bucketCount" INTEGER NOT NULL CHECK ("bucketCount" > "bucket"),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "status" TEXT NOT NULL DEFAULT 'RUNNING' CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
  "durationMs" INTEGER,
  "processedRows" INTEGER,
  "summary" JSONB,
  "error" TEXT
);
CREATE INDEX "SheetSyncAttempt_sourceKey_bucket_startedAt_idx" ON "SheetSyncAttempt"("sourceKey", "bucket", "startedAt");
CREATE INDEX "SheetSyncAttempt_status_startedAt_idx" ON "SheetSyncAttempt"("status", "startedAt");
