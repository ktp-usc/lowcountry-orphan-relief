import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Location } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

type InputRecord = {
  itemCode: string;
  year: number;
  location: string;
  startingQuantity: number;
};

type PreparedRecord = InputRecord & { itemId: number };

/** Validates and normalizes the JSON records before any database writes occur. */
function validateInput(value: unknown): InputRecord[] {
  if (!Array.isArray(value)) throw new Error("The JSON file must contain an array of records.");

  const validLocations = new Set<string>(Object.values(Location));
  const seen = new Set<string>();
  return value.map((record, index) => {
    const row = index + 1;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Record ${row} must be an object.`);
    }

    const { itemCode, year, location, startingQuantity } = record as Record<string, unknown>;
    if (typeof itemCode !== "string" || !itemCode.trim()) {
      throw new Error(`Record ${row} must have a non-empty itemCode.`);
    }
    if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 9999) {
      throw new Error(`Record ${row} has an invalid year; use an integer from 1900 to 9999.`);
    }
    if (typeof location !== "string" || !validLocations.has(location)) {
      throw new Error(`Record ${row} has an invalid location; use ${[...validLocations].join(" or ")}.`);
    }
    if (!Number.isInteger(startingQuantity) || (startingQuantity as number) < 0) {
      throw new Error(`Record ${row} startingQuantity must be a nonnegative integer.`);
    }

    const key = JSON.stringify([itemCode, year, location]);
    if (seen.has(key)) {
      throw new Error(`Record ${row} duplicates item/year/location ${itemCode}/${year}/${location}.`);
    }
    seen.add(key);
    return { itemCode, year: year as number, location, startingQuantity: startingQuantity as number };
  });
}

/** Imports starting inventory records from the JSON file passed on the command line. */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: import-starting-inventory <path-to-json-file>");

  const parsed: unknown = JSON.parse(await readFile(resolve(file), "utf8"));
  const records = validateInput(parsed);
  const codes = [...new Set(records.map(({ itemCode }) => itemCode))];
  const items = await prisma.item.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const itemIds = new Map(items.map(({ id, code }) => [code, id]));
  const unknownCodes = codes.filter((code) => !itemIds.has(code));
  if (unknownCodes.length) throw new Error(`Unknown item code(s): ${unknownCodes.join(", ")}. No records were saved.`);

  const prepared: PreparedRecord[] = records.map((record) => ({
    ...record,
    itemId: itemIds.get(record.itemCode)!,
  }));

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.startingInventory.findMany({
      where: { OR: prepared.map(({ itemId, year, location }) => ({ itemId, year, location: location as Location })) },
      select: { itemId: true, year: true, location: true },
    });
    const existingKeys = new Set(existing.map(({ itemId, year, location }) => JSON.stringify([itemId, year, location])));
    const toCreate = prepared.filter(({ itemId, year, location }) => !existingKeys.has(JSON.stringify([itemId, year, location])));
    const skipped = prepared.filter(({ itemId, year, location }) => existingKeys.has(JSON.stringify([itemId, year, location])));

    if (toCreate.length) {
      const created = await tx.startingInventory.createMany({
        data: toCreate.map(({ itemId, year, location, startingQuantity }) => ({
          itemId,
          year,
          location: location as Location,
          startingQuantity,
        })),
        skipDuplicates: true,
      });
      return { imported: created.count, skipped };
    }
    return { imported: toCreate.length, skipped };
  });

  for (const { itemCode, year, location } of result.skipped) {
    console.log(`Skipped existing: ${itemCode} / ${year} / ${location}`);
  }
  console.log(`Imported ${result.imported}; skipped ${result.skipped.length}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
