import type { Location } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getSheetRefreshStatus } from "../sheets/refresh-status";
import type { SheetRefreshStatus } from "../sheets/refresh-status";

import { calculateRow } from "./calculate-row";
import { getInventory } from "./get-inventory";
import { summarizeInventory } from "./summarize";
import type { InventoryRow, InventorySummary } from "./summarize";

export type DashboardData = {
  rows: InventoryRow[];
  summary: InventorySummary;
  refresh: SheetRefreshStatus;
};

// KAN-19 (database) -> KAN-12 (row math) -> KAN-13 (summary)
export async function getDashboard(
  year: number,
  location: Location,
): Promise<DashboardData> {
  const [inputs, refresh] = await Promise.all([
    getInventory(year, location),
    getSheetRefreshStatus(prisma, location),
  ]);

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
  return { rows, summary, refresh };
}
