export type InventoryRow = {
  itemName: string;
  initialCount: number;
  initialValue: number | null;
  itemsSubtracted: number;
  itemsAdded: number;
  currentCount: number;
  currentValue: number | null;
};

/**
 * Calculates an inventory row, preserving negative balances and unrounded values.
 * A null valuePerUnit (missing valuation) gives null initial and current values.
 */
export function calculateRow(
  itemName: string,
  initialCount: number,
  itemsAdded: number,
  itemsSubtracted: number,
  valuePerUnit: number | null,
): InventoryRow {
  const currentCount = initialCount + itemsAdded - itemsSubtracted;
  const initialValue =
    valuePerUnit === null ? null : initialCount * valuePerUnit;
  const currentValue =
    valuePerUnit === null ? null : currentCount * valuePerUnit;

  return {
    itemName,
    initialCount,
    initialValue,
    itemsSubtracted,
    itemsAdded,
    currentCount,
    currentValue,
  };
}