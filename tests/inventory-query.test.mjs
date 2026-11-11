import assert from "node:assert/strict";
import { test } from "node:test";
import { queryInventoryRows } from "../.seed-build/lib/inventory/get-inventory-query.js";
import { itemValuations } from "../.seed-build/prisma/seed-data.js";

function seededItems() {
  const items = itemValuations.map((row, index) => ({
    id: index + 1,
    code: row.code,
    displayName: row.displayName,
    valuations: [{ year: 2026, valuePerUnit: { toNumber: () => Number(row.valuePerUnit) } }],
    startingInventories: [],
    inventoryActivities: [],
  }));
  const codes = ["MENS_TOPS", "CHILDRENS_TOPS"];
  for (const fixture of [
    { location: "LOWCOUNTRY", initial: [100, 80], incoming: [20, 10], outgoing: [5, 3] },
    { location: "MIDLANDS", initial: [60, 40], incoming: [12, 8], outgoing: [4, 2] },
  ]) {
    for (const [index, code] of codes.entries()) {
      const item = items.find((row) => row.code === code);
      item.startingInventories.push({ year: 2026, location: fixture.location, startingQuantity: fixture.initial[index] });
      item.inventoryActivities.push(movement(fixture.location, "2026-01-02T12:00:00.000Z", "IN", fixture.incoming[index]));
      item.inventoryActivities.push(movement(fixture.location, "2026-01-03T12:00:00.000Z", "OUT", fixture.outgoing[index]));
    }
  }
  return items;
}

function movement(location, timestamp, direction, quantity) {
  return { direction, quantity, sourceSubmission: { location, submissionDate: new Date(timestamp) } };
}

// Relational fixture client: honors the submitted Prisma filter, rather than
// returning a precomputed successful result regardless of query conditions.
function clientFor(items) {
  const calls = [];
  return {
    calls,
    item: {
      findMany: async (query) => {
        calls.push(query);
        const valuationYear = query.where?.valuations?.some?.year;
        return items.filter((item) => valuationYear === undefined || item.valuations.some((v) => v.year === valuationYear))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((item) => {
            const opening = query.select.startingInventories.where;
            const source = query.select.inventoryActivities.where.sourceSubmission.is;
            return {
              displayName: item.displayName,
              valuations: item.valuations.filter((v) => v.year === query.select.valuations.where.year),
              startingInventories: item.startingInventories.filter((row) => row.year === opening.year &&
                (opening.location === undefined || row.location === opening.location)),
              inventoryActivities: item.inventoryActivities.filter((row) =>
                (source.location === undefined || row.sourceSubmission.location === source.location) &&
                row.sourceSubmission.submissionDate >= source.submissionDate.gte &&
                row.sourceSubmission.submissionDate < source.submissionDate.lt),
            };
          });
      },
    },
  };
}

const mensName = "Men's Tops (Shirts, Sweaters & Sweatshirts)";

test("seed fixtures: all 35 valued items and Lowcountry totals", async () => {
  const rows = await queryInventoryRows(clientFor(seededItems()), 2026, "LOWCOUNTRY");
  assert.equal(rows.length, 35);
  assert.deepEqual(rows.find((r) => r.itemName === mensName), {
    itemName: mensName, initialCount: 100, valuePerUnit: 10.12, itemsAdded: 20, itemsSubtracted: 5,
  });
});

test("seed fixtures: Midlands is isolated from Lowcountry", async () => {
  const rows = await queryInventoryRows(clientFor(seededItems()), 2026, "MIDLANDS");
  assert.equal(rows.length, 35);
  const row = rows.find((r) => r.itemName === mensName);
  assert.equal(row.initialCount, 60);
  assert.equal(row.itemsAdded, 12);
  assert.equal(row.itemsSubtracted, 4);
});

test("includes missing openings and no activity with zeros", async () => {
  const rows = await queryInventoryRows(clientFor(seededItems()), 2026, "LOWCOUNTRY");
  assert.deepEqual(rows.find((r) => r.itemName === "Diapers"), {
    itemName: "Diapers", initialCount: 0, valuePerUnit: 7.25, itemsAdded: 0, itemsSubtracted: 0,
  });
});

test("includes an explicit zero opening count", async () => {
  const items = seededItems();
  items.find((r) => r.code === "BOOKS").startingInventories.push({ year: 2026, location: "LOWCOUNTRY", startingQuantity: 0 });
  const rows = await queryInventoryRows(clientFor(items), 2026, "LOWCOUNTRY");
  assert.equal(rows.find((r) => r.itemName === "Books").initialCount, 0);
});

test("sums multiple IN and OUT activities per item", async () => {
  const items = seededItems();
  const item = items.find((r) => r.code === "MENS_TOPS");
  item.inventoryActivities.push(movement("LOWCOUNTRY", "2026-05-01T12:00:00Z", "IN", 7));
  item.inventoryActivities.push(movement("LOWCOUNTRY", "2026-05-02T12:00:00Z", "OUT", 3));
  const row = (await queryInventoryRows(clientFor(items), 2026, "LOWCOUNTRY")).find((r) => r.itemName === mensName);
  assert.equal(row.itemsAdded, 27);
  assert.equal(row.itemsSubtracted, 8);
});

test("year boundaries include January 1 and exclude next January 1", async () => {
  const items = seededItems();
  items.find((r) => r.code === "MENS_TOPS").inventoryActivities.push(
    movement("LOWCOUNTRY", "2025-12-31T23:59:59.999Z", "IN", 1000),
    movement("LOWCOUNTRY", "2026-01-01T00:00:00.000Z", "IN", 4),
    movement("LOWCOUNTRY", "2026-12-31T23:59:59.999Z", "OUT", 6),
    movement("LOWCOUNTRY", "2027-01-01T00:00:00.000Z", "OUT", 1000),
  );
  const row = (await queryInventoryRows(clientFor(items), 2026, "LOWCOUNTRY")).find((r) => r.itemName === mensName);
  assert.equal(row.itemsAdded, 24);
  assert.equal(row.itemsSubtracted, 11);
});

test("opening and valuation records are selected by year", async () => {
  const items = seededItems();
  const item = items.find((r) => r.code === "MENS_TOPS");
  for (const other of items) {
    if (other !== item) other.valuations.push({ year: 2027, valuePerUnit: other.valuations[0].valuePerUnit });
  }
  item.valuations.push({ year: 2027, valuePerUnit: { toNumber: () => 12.34 } });
  item.startingInventories.push({ year: 2027, location: "LOWCOUNTRY", startingQuantity: 123 });
  const row = (await queryInventoryRows(clientFor(items), 2027, "LOWCOUNTRY")).find((r) => r.itemName === mensName);
  assert.equal(row.initialCount, 123);
  assert.equal(row.valuePerUnit, 12.34);
  assert.equal(row.itemsAdded, 0);
});

test("invalid year is rejected before querying", async () => {
  const client = clientFor(seededItems());
  await assert.rejects(queryInventoryRows(client, 2026.5, "LOWCOUNTRY"), /year/i);
  assert.equal(client.calls.length, 0);
});

test("an item without a yearly valuation returns a null valuePerUnit", async () => {
  const items = seededItems();
  items.push({ id: 1000, code: "UNVALUED", displayName: "Unvalued item", valuations: [], startingInventories: [], inventoryActivities: [] });
  const rows = await queryInventoryRows(clientFor(items), 2026, "LOWCOUNTRY");
  const unvalued = rows.find((row) => row.itemName === "Unvalued item");
  assert.ok(unvalued, "the unvalued item is still returned");
  assert.strictEqual(unvalued.valuePerUnit, null);
  assert.strictEqual(unvalued.initialCount, 0);
  assert.strictEqual(unvalued.itemsAdded, 0);
  assert.strictEqual(unvalued.itemsSubtracted, 0);
});

test("invalid locations are rejected before querying", async () => {
  for (const location of [undefined, null, "", "ALL", "MIDLANDS ", 123]) {
    const client = clientFor(seededItems());
    await assert.rejects(queryInventoryRows(client, 2026, location), /location/i);
    assert.equal(client.calls.length, 0);
  }
});

test("an empty catalogue returns an empty array", async () => {
  assert.deepEqual(await queryInventoryRows(clientFor([]), 2026, "LOWCOUNTRY"), []);
});

test("a zero annual valuation is retained", async () => {
  const items = seededItems();
  items.find((row) => row.code === "BOOKS").valuations[0].valuePerUnit = { toNumber: () => 0 };
  const rows = await queryInventoryRows(clientFor(items), 2026, "LOWCOUNTRY");
  assert.equal(rows.find((row) => row.itemName === "Books").valuePerUnit, 0);
});
