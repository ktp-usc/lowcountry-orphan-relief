import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL for the seeded database.");

  const [{ PrismaClient }, { queryInventoryRows }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    import("../lib/inventory/get-inventory-query.ts"),
  ]);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });

  try {
    const lowcountry = await queryInventoryRows(prisma, 2026, "LOWCOUNTRY");
    const midlands = await queryInventoryRows(prisma, 2026, "MIDLANDS");
    assert.equal(lowcountry.length, 35, "Expected every valued category in Lowcountry.");
    assert.equal(midlands.length, 35, "Expected every valued category in Midlands.");

    const lowcountryTops = lowcountry.find((row) => row.itemName.startsWith("Men's Tops"));
    assert.deepEqual(lowcountryTops, {
      itemName: "Men's Tops (Shirts, Sweaters & Sweatshirts)",
      initialCount: 100,
      valuePerUnit: 10.12,
      quantitySub: 5,
      quantityAdd: 20,
    });

    const midlandsTops = midlands.find((row) => row.itemName.startsWith("Men's Tops"));
    assert.deepEqual(midlandsTops, {
      itemName: "Men's Tops (Shirts, Sweaters & Sweatshirts)",
      initialCount: 60,
      valuePerUnit: 10.12,
      quantitySub: 4,
      quantityAdd: 12,
    });

    const zeroActivityItem = lowcountry.find((row) => row.itemName === "Diapers");
    assert.deepEqual(zeroActivityItem, {
      itemName: "Diapers",
      initialCount: 0,
      valuePerUnit: 7.25,
      quantitySub: 0,
      quantityAdd: 0,
    });
    console.log("PASS: inventory query returns all 35 valued items and correctly filters seeded movements by location.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Inventory query test failed.");
  process.exitCode = 1;
});
