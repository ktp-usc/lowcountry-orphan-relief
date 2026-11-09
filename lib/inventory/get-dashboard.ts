import type { Location } from "@/generated/prisma/enums";

import { calculateRow } from "./calculate-row";
import { getInventory } from "./get-inventory";
import { summarizeInventory } from "./summarize";
import type { InventoryRow, InventorySummary } from "./summarize";

export type DashboardData = {
  rows: InventoryRow[];
  summary: InventorySummary;
};

// KAN-19 (database) -> KAN-12 (row math) -> KAN-13 (summary)
export async function getDashboard(
  year: number,
  location: Location,
): Promise<DashboardData> {
  const inputs = await getInventory(year, location);

  const rows: InventoryRow[] = inputs.map((input) =>
      calculateRow({
        itemName: input.itemName,
        initialCount: input.initialCount,
        itemsAdded: input.itemsAdded,
        itemsSubtracted: input.itemsSubtracted,
        valuePerUnit: input.valuePerUnit,
      }),
  );

  const summary = summarizeInventory(rows);
  return { rows, summary };
}