import { createHash } from "node:crypto";

export const inventoryModels = [
  "item", "itemValuation", "startingInventory", "sourceSubmission", "inventoryActivity",
];

/** Hash persisted rows in ID order without logging their contents. */
export async function snapshotInventory(prisma) {
  const snapshot = {};
  for (const model of inventoryModels) {
    const hash = createHash("sha256");
    let count = 0;
    let lastId;
    while (true) {
      const rows = await prisma[model].findMany({
        orderBy: { id: "asc" },
        take: 500,
        ...(lastId === undefined ? {} : { where: { id: { gt: lastId } } }),
      });
      if (rows.length === 0) break;
      for (const row of rows) hash.update(JSON.stringify(row)).update("\n");
      count += rows.length;
      lastId = rows.at(-1).id;
    }
    snapshot[model] = { count, sha256: hash.digest("hex") };
  }
  return snapshot;
}
