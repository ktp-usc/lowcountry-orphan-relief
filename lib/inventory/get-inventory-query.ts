import type { PrismaClient } from "../../generated/prisma/client";
import type { Location } from "../../generated/prisma/enums";

export type InventoryCalculationInput = {
  itemName: string;
  initialCount: number;
  valuePerUnit: number;
  quantitySub: number;
  quantityAdd: number;
};

type InventoryQueryClient = Pick<PrismaClient, "item">;

export async function queryInventoryRows(
  client: InventoryQueryClient,
  year: number,
  location: Location,
): Promise<InventoryCalculationInput[]> {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error("Provide a reporting year between 1900 and 9999.");
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  const items = await client.item.findMany({
    where: { valuations: { some: { year } } },
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
    if (!valuation) {
      throw new Error(`Missing ${year} valuation for ${item.displayName}.`);
    }

    let quantitySub = 0;
    let quantityAdd = 0;
    for (const activity of item.inventoryActivities) {
      if (activity.direction === "IN") quantityAdd += activity.quantity;
      else quantitySub += activity.quantity;
    }

    return {
      itemName: item.displayName,
      initialCount: item.startingInventories[0]?.startingQuantity ?? 0,
      valuePerUnit: valuation.valuePerUnit.toNumber(),
      quantitySub,
      quantityAdd,
    };
  });
}
