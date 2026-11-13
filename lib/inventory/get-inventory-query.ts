import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Location } from "../../generated/prisma/enums.js";

export type InventoryCalculationInput = {
  itemName: string;
  initialCount: number;
  valuePerUnit: number | null;
  itemsSubtracted: number;
  itemsAdded: number;
};

type InventoryQueryClient = Pick<PrismaClient, "item">;

/**
 * Return every catalog item for a UTC reporting year and one location.
 * Missing opening counts and activity become zero. 
 * A missing yearly valuation returns a null valuePerUnit for that item.
 */
export async function queryInventoryRows(
  client: InventoryQueryClient,
  year: number,
  location: Location,
  options?: { excludeItemCodes?: readonly string[] },
): Promise<InventoryCalculationInput[]> {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error("Provide a reporting year between 1900 and 9999.");
  }
  if (location !== "LOWCOUNTRY" && location !== "MIDLANDS") {
    throw new Error("Provide location LOWCOUNTRY or MIDLANDS.");
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  const items = await client.item.findMany({
    ...(options?.excludeItemCodes?.length ? {
      where: { code: { notIn: [...options.excludeItemCodes] } },
    } : {}),
    select: {
      displayName: true,
      valuations: {
        where: { year },
        select: { valuePerUnit: true },
      },
      startingInventories: {
        where: { year, location },
        select: { startingQuantity: true },
      },
      inventoryActivities: {
        where: {
          sourceSubmission: {
            is: {
              location,
              submissionDate: { gte: yearStart, lt: nextYearStart },
            },
          },
        },
        select: { direction: true, quantity: true },
      },
    },
    orderBy: { displayName: "asc" },
  });

  return items.map((item) => {
    const valuation = item.valuations[0];

    let itemsSubtracted = 0;
    let itemsAdded = 0;
    for (const activity of item.inventoryActivities) {
      if (activity.direction === "IN") itemsAdded += activity.quantity;
      else itemsSubtracted += activity.quantity;
    }

    return {
      itemName: item.displayName,
      initialCount: item.startingInventories[0]?.startingQuantity ?? 0,
      valuePerUnit: valuation ? valuation.valuePerUnit.toNumber() : null,
      itemsSubtracted,
      itemsAdded,
    };
  });
}
