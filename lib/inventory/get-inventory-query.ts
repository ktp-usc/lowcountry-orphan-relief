import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Location } from "../../generated/prisma/enums.js";

export type DashboardLocation = Location | "ALL";

export type InventoryCalculationInput = {
  itemName: string;
  initialCount: number;
    valuePerUnit: number | null;
  quantitySub: number;
  quantityAdd: number;
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
  location: DashboardLocation,
): Promise<InventoryCalculationInput[]> {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error("Provide a reporting year between 1900 and 9999.");
  }
  if (
    location !== "ALL" &&
    location !== "LOWCOUNTRY" &&
    location !== "MIDLANDS"
  ) {
    throw new Error("Provide location ALL, LOWCOUNTRY, or MIDLANDS.");
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  const startingInventoryWhere =
    location === "ALL" ? { year } : { year, location };
  const sourceSubmissionWhere =
    location === "ALL"
      ? { submissionDate: { gte: yearStart, lt: nextYearStart } }
      : {
          location,
          submissionDate: { gte: yearStart, lt: nextYearStart },
        };

  const items = await client.item.findMany({
    select: {
      displayName: true,
      valuations: {
        where: { year },
        select: { valuePerUnit: true },
      },
      startingInventories: {
        where: startingInventoryWhere,
        select: { startingQuantity: true },
      },
      inventoryActivities: {
        where: {
          sourceSubmission: {
            is: sourceSubmissionWhere,
          },
        },
        select: { direction: true, quantity: true },
      },
    },
    orderBy: { displayName: "asc" },
  });

  return items.map((item) => {
    const valuation = item.valuations[0];

    let quantitySub = 0;
    let quantityAdd = 0;
    for (const activity of item.inventoryActivities) {
      if (activity.direction === "IN") quantityAdd += activity.quantity;
      else quantitySub += activity.quantity;
    }

    const initialCount = item.startingInventories.reduce(
      (sum, opening) => sum + opening.startingQuantity,
      0,
    );

    return {
      itemName: item.displayName,
      initialCount,
      valuePerUnit: valuation ? valuation.valuePerUnit.toNumber() : null,
      quantitySub,
      quantityAdd,
    };
  });
}
