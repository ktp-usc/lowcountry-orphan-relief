export type InventoryRow = {
  itemName: string;
  initialCount: number;
  initialValue: number;
  itemsSubtracted: number;
  itemsAdded: number;
  currentCount: number;
  currentValue: number;
};

export type RowInput = {
  itemName: string;
  initialCount: number;
  itemsAdded: number;
  itemsSubtracted: number;
  valuePerUnit: number;
};

/** Calculates an inventory row, preserving negative balances and unrounded values. */
export function calculateRow(
  { itemName, initialCount, itemsAdded, itemsSubtracted, valuePerUnit }: RowInput,
): InventoryRow {
  const currentCount = initialCount + itemsAdded - itemsSubtracted;
  const initialValue = initialCount * valuePerUnit;
  const currentValue = currentCount * valuePerUnit;

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
