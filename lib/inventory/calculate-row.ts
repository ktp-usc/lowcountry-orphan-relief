export type InventoryRow = {
    itemName: string;
    valuePerUnit: number | null;
    initialCount: number;
    initialValue: number | null;
    itemsSubtracted: number;
    itemsAdded: number;
    currentCount: number;
    currentValue: number | null;
};

export type RowInput = {
    itemName: string;
    initialCount: number;
    itemsAdded: number;
    itemsSubtracted: number;
    valuePerUnit: number | null;
};

export function calculateRow({
         itemName,
         initialCount,
         itemsAdded,
         itemsSubtracted,
         valuePerUnit,
     }: RowInput): InventoryRow {
    const currentCount = initialCount + itemsAdded - itemsSubtracted;

    return {
        itemName,
        valuePerUnit,
        initialCount,
        initialValue:
            valuePerUnit === null ? null : initialCount * valuePerUnit,
        itemsSubtracted,
        itemsAdded,
        currentCount,
        currentValue:
            valuePerUnit === null ? null : currentCount * valuePerUnit,
    };
}
