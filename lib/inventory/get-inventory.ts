import { prisma } from "@/lib/prisma";
import { queryInventoryRows } from "./get-inventory-query";
import type { InventoryCalculationInput } from "./get-inventory-query";
import type { Location } from "@/generated/prisma/enums";

export type { InventoryCalculationInput } from "./get-inventory-query";

/** Load calculation inputs through the shared server-side Prisma client. */
export function getInventory(
  year: number,
  location: Location,
): Promise<InventoryCalculationInput[]> {
  return queryInventoryRows(prisma, year, location);
}
