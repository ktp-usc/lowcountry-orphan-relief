import assert from "node:assert/strict";
import test from "node:test";
import { summarizeInventory } from "./summarize.ts";

test("summarizes inventory rows", () => {
  const rows = [
    {
      itemName: "Blankets",
      initialCount: 10,
      initialValue: 100,
      quantitySub: 2,
      quantityAdd: 5,
      currentCount: 13,
      currentValue: 130,
    },
    {
      itemName: "Pillows",
      initialCount: 20,
      initialValue: 200,
      quantitySub: 4,
      quantityAdd: 3,
      currentCount: 19,
      currentValue: 190,
    },
  ];

  assert.deepEqual(summarizeInventory(rows), {
    totalInitialCount: 30,
    totalInitialValue: 300,
    totalItemsSubtracted: 6,
    totalItemsAdded: 8,
    totalCurrentCount: 32,
    totalCurrentValue: 320,
  });
});

test("returns zero totals for an empty inventory", () => {
  assert.deepEqual(summarizeInventory([]), {
    totalInitialCount: 0,
    totalInitialValue: 0,
    totalItemsSubtracted: 0,
    totalItemsAdded: 0,
    totalCurrentCount: 0,
    totalCurrentValue: 0,
  });
});
