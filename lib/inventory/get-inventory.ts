import { prisma } from "@/lib/prisma";
import { queryInventoryRows } from "./get-inventory-query";
import type { InventoryCalculationInput } from "./get-inventory-query";
import type { DashboardLocation } from "./get-inventory-query";

export type { InventoryCalculationInput } from "./get-inventory-query";

/** Load calculation inputs through the shared server-side Prisma client. */
export function getInventory(
  year: number,
  location: DashboardLocation,
): Promise<InventoryCalculationInput[]> {
  return queryInventoryRows(prisma, year, location);
}
