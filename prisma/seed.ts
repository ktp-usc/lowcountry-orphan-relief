import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import {
  InventoryDirection,
  Location,
  SourceType,
} from "../generated/prisma/enums.js";
import { itemValuations } from "./seed-data.js";

// The reporting year to which this reference table is being applied. This is
// not a claim that the source document was published in this year.
const defaultReportingYear = 2026;

type SeededItem = { id: number; code: string };

function validateCatalogue() {
  if (itemValuations.length === 0) {
    throw new Error(
      "The valuation catalogue is empty. No data was seeded.",
    );
  }
  const codes = new Set<string>();
  for (const { code, displayName, valuePerUnit } of itemValuations) {
    if (!code.trim() || !displayName.trim() || codes.has(code)) {
      throw new Error("The valuation catalogue contains an empty code/name or a duplicate item code.");
    }
    if (!/^\d{1,10}\.\d{2}$/.test(valuePerUnit)) {
      throw new Error(`Item ${code} must have a nonnegative USD value with two decimal places.`);
    }
    codes.add(code);
  }
}

async function seedCatalogue(tx: Prisma.TransactionClient, year: number) {
  const items: SeededItem[] = [];
  for (const { code, displayName, valuePerUnit } of itemValuations) {
    const item = await tx.item.upsert({
      where: { code },
      update: { displayName },
      create: { code, displayName },
    });
    const amount = new Prisma.Decimal(valuePerUnit);
    await tx.itemValuation.upsert({
      where: { itemId_year: { itemId: item.id, year } },
      update: { valuePerUnit: amount },
      create: { itemId: item.id, year, valuePerUnit: amount },
    });
    items.push({ id: item.id, code: item.code });
  }
  return items;
}

async function seedDemo(
  tx: Prisma.TransactionClient,
  year: number,
  catalogue: readonly SeededItem[],
) {
  // Demonstration counts use actual catalogue items and actual reference
  // valuations. Only the counts, submissions and movements are fictional.
  const demoItems: SeededItem[] = [];
  for (const code of ["MENS_TOPS", "CHILDRENS_TOPS"]) {
    const item = catalogue.find((entry) => entry.code === code);
    if (!item) throw new Error(`The demo catalogue is missing ${code}.`);
    demoItems.push(item);
  }
  const locations = [
    { location: Location.LOWCOUNTRY, initial: [100, 80], incoming: [20, 10], outgoing: [5, 3] },
    { location: Location.MIDLANDS, initial: [60, 40], incoming: [12, 8], outgoing: [4, 2] },
  ] as const;

  for (const fixture of locations) {
    for (const [index, item] of demoItems.entries()) {
      await tx.startingInventory.upsert({
        where: {
          itemId_year_location: {
            itemId: item.id,
            year,
            location: fixture.location,
          },
        },
        update: {},
        create: {
          itemId: item.id,
          year,
          location: fixture.location,
          startingQuantity: fixture.initial[index],
        },
      });
    }

    const movements = [
      {
        direction: InventoryDirection.IN,
        sourceType: SourceType.INVENTORY,
        submissionDate: new Date(`${year}-01-02T12:00:00.000Z`),
        quantities: fixture.incoming,
      },
      {
        direction: InventoryDirection.OUT,
        sourceType: SourceType.REFERRAL,
        submissionDate: new Date(`${year}-01-03T12:00:00.000Z`),
        quantities: fixture.outgoing,
      },
    ];

    for (const movement of movements) {
      // Separate identifiers from the superseded demo that used DEMO_ items.
      const jotformFormId = `SEED_DEMO_IRS_${fixture.location}_${movement.sourceType}`;
      const jotformSubmissionId = `SEED_DEMO_IRS_${year}_${fixture.location}_${movement.direction}`;
      await tx.sourceSubmission.upsert({
        where: { jotformFormId_jotformSubmissionId: { jotformFormId, jotformSubmissionId } },
        update: {},
        create: {
          jotformFormId,
          jotformSubmissionId,
          location: fixture.location,
          sourceType: movement.sourceType,
          submissionDate: movement.submissionDate,
          inventoryActivities: {
            create: demoItems.map((item, index) => ({
              item: { connect: { id: item.id } },
              quantity: movement.quantities[index],
              direction: movement.direction,
            })),
          },
        },
      });
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      demo: { type: "boolean", default: false },
      year: { type: "string", default: String(defaultReportingYear) },
    },
  });
  if (!/^\d{4}$/.test(values.year!) || Number(values.year) < 1900) {
    throw new Error("Use --year followed by a four-digit reporting year of 1900 or later.");
  }
  const year = Number(values.year);
  validateCatalogue();

  // Match prisma.config.ts: direct connection first, pooled connection fallback.
  const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Set DIRECT_URL or DATABASE_URL in .env before running the seed command.");
  }
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 });
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.$transaction(async (tx) => {
      const catalogue = await seedCatalogue(tx, year);
      if (values.demo) await seedDemo(tx, year, catalogue);
    }, { timeout: 60_000 });
    console.log(`Seeded ${itemValuations.length} reference categories and valuations for ${year}.`);
    if (values.demo) {
      console.log("Fictional opening counts, submissions and movements seeded for both locations.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Inventory seeding failed.");
  process.exitCode = 1;
});
