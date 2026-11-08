export type RowInput = {
  itemName: string;
  initialCount: number;
  quantityAdd: number;
  quantitySub: number;
  valuePerUnit: number;
};

export type InventoryRow = {
  itemName: string;
  initialCount: number;
  initialValue: number;
  quantitySub: number;
  quantityAdd: number;
  currentCount: number;
  currentValue: number;
};

/** Calculates an inventory row, preserving negative balances and unrounded values. */
export function calculateRow(input: RowInput): InventoryRow {
  const { itemName, initialCount, quantityAdd, quantitySub, valuePerUnit } = input;
  const currentCount = initialCount + quantityAdd - quantitySub;
  const initialValue = initialCount * valuePerUnit;
  const currentValue = currentCount * valuePerUnit;

  return {
    itemName,
    initialCount,
    initialValue,
    quantitySub,
    quantityAdd,
    currentCount,
    currentValue,
  };
}
