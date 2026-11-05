import "dotenv/config";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const { values } = parseArgs({
    options: {
      demo: { type: "boolean", default: false },
      year: { type: "string", default: "2026" },
    },
  });
  const year = Number(values.year);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error("Provide a valid reporting year.");
  const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Set DIRECT_URL or DATABASE_URL in .env first.");
  const [{ PrismaClient }, { itemValuations }] = await Promise.all([
    import("../.seed-build/generated/prisma/client.js"),
    import("../.seed-build/prisma/seed-data.js"),
  ]);
  assert.equal(itemValuations.length, 35);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });
  try {
    const items = await prisma.item.findMany({
      where: { code: { in: itemValuations.map((row) => row.code) } },
      include: { valuations: { where: { year } } },
    });
    assert.equal(items.length, 35, "Expected all 35 source categories.");
    const byCode = new Map(items.map((item) => [item.code, item]));
    for (const expected of itemValuations) {
      const item = byCode.get(expected.code);
      assert.ok(item, `Missing category ${expected.code}.`);
      assert.equal(item.displayName, expected.displayName, `Wrong name for ${expected.code}.`);
      assert.equal(item.valuations.length, 1, `Expected one ${year} valuation for ${expected.code}.`);
      assert.equal(item.valuations[0].valuePerUnit.toFixed(2), expected.valuePerUnit, `Wrong price for ${expected.code}.`);
    }

    if (values.demo) {
      const codes = ["MENS_TOPS", "CHILDRENS_TOPS"];
      const fixtures = [
        { location: "LOWCOUNTRY", sourceType: "INVENTORY", direction: "IN", quantities: [20, 10] },
        { location: "LOWCOUNTRY", sourceType: "REFERRAL", direction: "OUT", quantities: [5, 3] },
        { location: "MIDLANDS", sourceType: "INVENTORY", direction: "IN", quantities: [12, 8] },
        { location: "MIDLANDS", sourceType: "REFERRAL", direction: "OUT", quantities: [4, 2] },
      ];
      for (const fixture of fixtures) {
        const jotformFormId = `SEED_DEMO_IRS_${fixture.location}_${fixture.sourceType}`;
        const jotformSubmissionId = `SEED_DEMO_IRS_${year}_${fixture.location}_${fixture.direction}`;
        const source = await prisma.sourceSubmission.findUnique({
          where: { jotformFormId_jotformSubmissionId: { jotformFormId, jotformSubmissionId } },
          include: { inventoryActivities: { include: { item: true } } },
        });
        assert.ok(source, `Missing ${fixture.location} ${fixture.direction} demo submission.`);
        assert.equal(source.location, fixture.location);
        assert.equal(source.sourceType, fixture.sourceType);
        assert.equal(source.inventoryActivities.length, 2, "Missing or duplicate demo activities.");
        for (const [index, code] of codes.entries()) {
          const activity = source.inventoryActivities.find((row) => row.item.code === code);
          assert.ok(activity, `Missing ${code} demo activity.`);
          assert.equal(activity.direction, fixture.direction);
          assert.equal(activity.quantity, fixture.quantities[index]);
        }
      }
      const openingCounts = await prisma.startingInventory.count({
        where: {
          year,
          itemId: { in: codes.map((code) => byCode.get(code).id) },
          location: { in: ["LOWCOUNTRY", "MIDLANDS"] },
        },
      });
      assert.equal(openingCounts, 4, "Expected openings for both demo items at both locations.");
    }
    console.log(`PASS: 35 real categories and ${year} valuations${values.demo ? ", four demo submissions and eight activities" : ""}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed verification failed.");
  process.exitCode = 1;
});
