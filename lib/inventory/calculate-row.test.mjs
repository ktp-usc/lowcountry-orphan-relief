import assert from "node:assert/strict";
import test from "node:test";
import { calculateRow } from "./calculate-row.ts";

test("calculates counts and values from an inventory input", () => {
  assert.deepEqual(
    calculateRow({
      itemName: "Blankets",
      initialCount: 10,
      itemsAdded: 5,
      itemsSubtracted: 2,
      valuePerUnit: 2.5,
    }),
    {
      itemName: "Blankets",
      initialCount: 10,
      initialValue: 25,
      itemsSubtracted: 2,
      itemsAdded: 5,
      currentCount: 13,
      currentValue: 32.5,
    },
  );
});

test("preserves zero counts, movements, and values", () => {
  assert.deepEqual(
    calculateRow({
      itemName: "New item",
      initialCount: 0,
      itemsAdded: 0,
      itemsSubtracted: 0,
      valuePerUnit: 0,
    }),
    {
      itemName: "New item",
      initialCount: 0,
      initialValue: 0,
      itemsSubtracted: 0,
      itemsAdded: 0,
      currentCount: 0,
      currentValue: 0,
    },
  );
});

test("preserves negative balances and unrounded values", () => {
  const row = calculateRow({
    itemName: "Books",
    initialCount: 1,
    itemsAdded: 0,
    itemsSubtracted: 3,
    valuePerUnit: 0.333,
  });

  assert.equal(row.currentCount, -2);
  assert.equal(row.initialValue, 0.333);
  assert.equal(row.currentValue, -0.666);
});
