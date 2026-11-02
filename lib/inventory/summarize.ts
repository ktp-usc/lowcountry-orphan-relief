export interface InventoryRow {
  itemName: string;
  initialCount: number;
  initialValue: number;
  quantitySub: number;
  quantityAdd: number;
  currentCount: number;
  currentValue: number;
}

export interface InventorySummary {
  totalInitialCount: number;
  totalInitialValue: number;
  totalItemsSubtracted: number;
  totalItemsAdded: number;
  totalCurrentCount: number;
  totalCurrentValue: number;
}

export function summarizeInventory(rows: InventoryRow[]): InventorySummary {
  return rows.reduce<InventorySummary>(
    (summary, row) => ({
      totalInitialCount: summary.totalInitialCount + row.initialCount,
      totalInitialValue: summary.totalInitialValue + row.initialValue,
      totalItemsSubtracted: summary.totalItemsSubtracted + row.quantitySub,
      totalItemsAdded: summary.totalItemsAdded + row.quantityAdd,
      totalCurrentCount: summary.totalCurrentCount + row.currentCount,
      totalCurrentValue: summary.totalCurrentValue + row.currentValue,
    }),
    {
      totalInitialCount: 0,
      totalInitialValue: 0,
      totalItemsSubtracted: 0,
      totalItemsAdded: 0,
      totalCurrentCount: 0,
      totalCurrentValue: 0,
    },
  );
}
