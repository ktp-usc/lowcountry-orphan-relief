CREATE TYPE "Location" AS ENUM ('LOWCOUNTRY', 'MIDLANDS');
CREATE TYPE "SourceType" AS ENUM ('INVENTORY', 'REFERRAL');
CREATE TYPE "InventoryDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "Item" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceSubmission" (
    "id" SERIAL NOT NULL,
    "jotformFormId" TEXT NOT NULL,
    "jotformSubmissionId" TEXT NOT NULL,
    "location" "Location" NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "submissionDate" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "SourceSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryActivity" (
    "id" SERIAL NOT NULL,
    "jotformFormId" TEXT NOT NULL,
    "jotformSubmissionId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "direction" "InventoryDirection" NOT NULL,
    CONSTRAINT "InventoryActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryActivity_quantity_positive" CHECK ("quantity" > 0)
);

CREATE TABLE "StartingInventory" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "location" "Location" NOT NULL,
    "startingQuantity" INTEGER NOT NULL,
    CONSTRAINT "StartingInventory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StartingInventory_quantity_nonnegative" CHECK ("startingQuantity" >= 0)
);

CREATE TABLE "ItemValuation" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "valuePerUnit" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "ItemValuation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ItemValuation_value_nonnegative" CHECK ("valuePerUnit" >= 0)
);

CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");
CREATE UNIQUE INDEX "SourceSubmission_jotformFormId_jotformSubmissionId_key"
    ON "SourceSubmission"("jotformFormId", "jotformSubmissionId");
CREATE INDEX "SourceSubmission_location_submissionDate_idx"
    ON "SourceSubmission"("location", "submissionDate");
CREATE INDEX "InventoryActivity_jotformFormId_jotformSubmissionId_idx"
    ON "InventoryActivity"("jotformFormId", "jotformSubmissionId");
CREATE INDEX "InventoryActivity_itemId_idx" ON "InventoryActivity"("itemId");
CREATE UNIQUE INDEX "StartingInventory_itemId_year_location_key"
    ON "StartingInventory"("itemId", "year", "location");
CREATE INDEX "StartingInventory_location_year_idx" ON "StartingInventory"("location", "year");
CREATE UNIQUE INDEX "ItemValuation_itemId_year_key" ON "ItemValuation"("itemId", "year");

ALTER TABLE "InventoryActivity"
    ADD CONSTRAINT "InventoryActivity_jotformFormId_jotformSubmissionId_fkey"
    FOREIGN KEY ("jotformFormId", "jotformSubmissionId")
    REFERENCES "SourceSubmission"("jotformFormId", "jotformSubmissionId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryActivity"
    ADD CONSTRAINT "InventoryActivity_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StartingInventory"
    ADD CONSTRAINT "StartingInventory_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemValuation"
    ADD CONSTRAINT "ItemValuation_itemId_fkey" FOREIGN KEY ("itemId")
    REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
