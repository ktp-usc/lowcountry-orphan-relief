import type { DashboardLocation } from "./get-inventory-query";

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
  location: DashboardLocation,
): Promise<DashboardData> {
  const inputs = await getInventory(year, location);

  const rows: InventoryRow[] = inputs.map((input) => {
    const row = calculateRow(
      input.itemName,
      input.initialCount,
      input.quantityAdd,
      input.quantitySub,
      input.valuePerUnit,
    );
    // The summary function uses quantityAdd/quantitySub, so rename here
    return {
      itemName: row.itemName,
      initialCount: row.initialCount,
      initialValue: row.initialValue,
      quantitySub: row.itemsSubtracted,
      quantityAdd: row.itemsAdded,
      currentCount: row.currentCount,
      currentValue: row.currentValue,
    };
  });

  const summary = summarizeInventory(rows);
  return { rows, summary };
}