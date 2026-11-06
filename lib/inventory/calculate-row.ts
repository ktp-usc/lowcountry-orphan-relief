import type { InventoryRow } from "./summarize";

export type RowInput = {
  itemName: string;
  initialCount: number;
  quantityAdd: number;
  quantitySub: number;
  valuePerUnit: number;
};

// TEMPORARY STAND-IN for KAN-12.
// When the real KAN-12 file is merged, use your teammate's version of this file.
export function calculateRow(input: RowInput): InventoryRow {
  const currentCount =
    input.initialCount + input.quantityAdd - input.quantitySub;
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    itemName: input.itemName,
    initialCount: input.initialCount,
    initialValue: round(input.initialCount * input.valuePerUnit),
    quantitySub: input.quantitySub,
    quantityAdd: input.quantityAdd,
    currentCount,
    currentValue: round(currentCount * input.valuePerUnit),
  };
}