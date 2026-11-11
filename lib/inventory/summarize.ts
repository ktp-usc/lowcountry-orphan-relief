export interface InventoryRow {
  itemName: string;
  initialCount: number;
  initialValue: number | null;
  itemsSubtracted: number;
  itemsAdded: number;
  currentCount: number;
  currentValue: number | null;
}

export interface InventorySummary {
  totalInitialCount: number;
  totalInitialValue: number | null;
  totalItemsSubtracted: number;
  totalItemsAdded: number;
  totalCurrentCount: number;
  totalCurrentValue: number | null;
}

export function summarizeInventory(rows: InventoryRow[]): InventorySummary {
  const missingInitialValue = rows.some((row) => row.initialValue === null);
  const missingCurrentValue = rows.some((row) => row.currentValue === null);

  return {
    totalInitialCount: rows.reduce((sum, row) => sum + row.initialCount, 0),
    totalInitialValue: missingInitialValue
      ? null
      : rows.reduce((sum, row) => sum + (row.initialValue ?? 0), 0),
    totalItemsSubtracted: rows.reduce((sum, row) => sum + row.itemsSubtracted, 0),
    totalItemsAdded: rows.reduce((sum, row) => sum + row.itemsAdded, 0),
    totalCurrentCount: rows.reduce((sum, row) => sum + row.currentCount, 0),
    totalCurrentValue: missingCurrentValue
      ? null
      : rows.reduce((sum, row) => sum + (row.currentValue ?? 0), 0),
  };
}
