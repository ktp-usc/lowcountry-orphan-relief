import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  InventoryDirection,
  Location,
  Prisma,
  PrismaClient,
  SourceType,
} from "../generated/prisma/client";

// Starter categories; match these codes to the normalizer's item mapping.
const items = [
  { code: "TOPS", displayName: "Tops" },
  { code: "BOTTOMS", displayName: "Bottoms" },
  { code: "JACKETS", displayName: "Jackets" },
  { code: "DRESSES", displayName: "Dresses" },
  { code: "PAJAMAS", displayName: "Pajamas" },
  { code: "UNDERWEAR", displayName: "Underwear" },
  { code: "SOCKS", displayName: "Socks" },
  { code: "SHOES", displayName: "Shoes" },
  { code: "BLANKETS", displayName: "Blankets" },
  { code: "DIAPERS", displayName: "Diapers" },
  { code: "PULL_UPS", displayName: "Pull-ups" },
  { code: "WIPES", displayName: "Wipes" },
  { code: "TOILETRIES", displayName: "Toiletries" },
  { code: "SCHOOL_UNIFORM_TOPS", displayName: "School uniform tops" },
  { code: "SCHOOL_UNIFORM_BOTTOMS", displayName: "School uniform bottoms" },
] satisfies Prisma.ItemCreateManyInput[];

// Fixed year and identifiers keep the optional fixtures stable across reruns.
const demoYear = 2026;

async function seedDemo(tx: Prisma.TransactionClient) {
  const tops = await tx.item.upsert({
    where: { code: "DEMO_TOPS" },
    update: {},
    create: { code: "DEMO_TOPS", displayName: "Demo tops" },
  });
  const bottoms = await tx.item.upsert({
    where: { code: "DEMO_BOTTOMS" },
    update: {},
    create: { code: "DEMO_BOTTOMS", displayName: "Demo bottoms" },
  });
  const demoItems = [
    { id: tops.id, valuePerUnit: new Prisma.Decimal("5.00") },
    { id: bottoms.id, valuePerUnit: new Prisma.Decimal("7.50") },
  ];

  // These are fictional development values, not approved IRS valuations.
  for (const item of demoItems) {
    await tx.itemValuation.upsert({
      where: { itemId_year: { itemId: item.id, year: demoYear } },
      update: {},
      create: { itemId: item.id, year: demoYear, valuePerUnit: item.valuePerUnit },
    });
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
            year: demoYear,
            location: fixture.location,
          },
        },
        update: {},
        create: {
          itemId: item.id,
          year: demoYear,
          location: fixture.location,
          startingQuantity: fixture.initial[index],
        },
      });
    }

    const movements = [
      {
        direction: InventoryDirection.IN,
        sourceType: SourceType.INVENTORY,
        submissionDate: new Date("2026-01-02T12:00:00.000Z"),
        quantities: fixture.incoming,
      },
      {
        direction: InventoryDirection.OUT,
        sourceType: SourceType.REFERRAL,
        submissionDate: new Date("2026-01-03T12:00:00.000Z"),
        quantities: fixture.outgoing,
      },
    ];

    for (const movement of movements) {
      const jotformFormId = `SEED_DEMO_${fixture.location}_${movement.sourceType}`;
      const jotformSubmissionId = `SEED_DEMO_${demoYear}_${fixture.location}_${movement.direction}`;

      // Nested creation is atomic. An existing source is left unchanged, so
      // rerunning the seed cannot append duplicate activity rows.
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
    options: { demo: { type: "boolean", default: false } },
  });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set DATABASE_URL in .env before running the seed command.");
  }

  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.item.createMany({ data: items, skipDuplicates: true });
      if (values.demo) await seedDemo(tx);
    }, { timeout: 30_000 });

    console.log("Item catalogue seeded; existing records preserved.");
    if (values.demo) {
      console.log(`Demo fixtures for ${demoYear} seeded for Lowcountry and Midlands.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Inventory seeding failed.");
  process.exitCode = 1;
});
