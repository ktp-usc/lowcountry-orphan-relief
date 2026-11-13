import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSheetRefreshStatus } from "../lib/sheets/refresh-status.ts";
import { SHEET_SYNC_BUCKET_COUNTS } from "../lib/sheets/cron-config.ts";
import { InventoryRefreshStatus } from "../components/inventory-refresh-status.tsx";

const client = (rows) => ({ sheetSyncJob: { findMany: async ({ where, select }) => {
  assert.equal(select.lastSuccessfulAt, true);
  return rows.filter((row) => where.sourceKey.in.includes(row.sourceKey));
} } });
const job = (sourceKey, date, bucket = 0, count = 1) => ({
  sourceKey, bucket, lastSuccessBucketCount: count, lastSuccessfulAt: date ? new Date(date) : null,
});

test("refresh timestamps are scoped to the selected location and each source", async () => {
  const db = client([
    job("lor-inventory", "2026-11-12T01:00:00Z"), job("lor-referral", "2026-11-12T05:00:00Z"),
    job("mor-inventory", "2026-11-11T03:00:00Z"), job("mor-referral", null),
  ]);
  assert.deepEqual(await getSheetRefreshStatus(db, "LOWCOUNTRY"), {
    inventory: "2026-11-12T01:00:00.000Z", referrals: "2026-11-12T05:00:00.000Z", unavailable: false,
  });
  assert.deepEqual(await getSheetRefreshStatus(db, "MIDLANDS"), {
    inventory: "2026-11-11T03:00:00.000Z", referrals: null, unavailable: false,
  });
});

test("missing history and query failures do not fabricate freshness", async () => {
  assert.deepEqual(await getSheetRefreshStatus(client([]), "LOWCOUNTRY"), {
    inventory: null, referrals: null, unavailable: false,
  });
  assert.deepEqual(await getSheetRefreshStatus({ sheetSyncJob: { findMany: async () => { throw new Error("missing table"); } } }, "LOWCOUNTRY"), {
    inventory: null, referrals: null, unavailable: true,
  });
});

test("all current buckets must have succeeded and the oldest bucket determines freshness", async () => {
  const original = SHEET_SYNC_BUCKET_COUNTS["lor-inventory"];
  SHEET_SYNC_BUCKET_COUNTS["lor-inventory"] = 2;
  try {
    const older = job("lor-inventory", "2026-11-11T01:00:00Z", 0, 2);
    const newer = job("lor-inventory", "2026-11-12T01:00:00Z", 1, 2);
    assert.equal((await getSheetRefreshStatus(client([older, newer]), "LOWCOUNTRY")).inventory, "2026-11-11T01:00:00.000Z");
    assert.equal((await getSheetRefreshStatus(client([newer]), "LOWCOUNTRY")).inventory, null);
    assert.equal((await getSheetRefreshStatus(client([{ ...older, lastSuccessBucketCount: 1 }, newer]), "LOWCOUNTRY")).inventory, null);
  } finally { SHEET_SYNC_BUCKET_COUNTS["lor-inventory"] = original; }
});

test("dashboard indicator shows available Eastern times and hides missing refresh times", () => {
  const render = (refresh) => renderToStaticMarkup(createElement(InventoryRefreshStatus, { refresh }));
  const html = render({ inventory: "2026-11-12T15:30:00.000Z", referrals: null, unavailable: false });
  assert.match(html, /Last successful refresh/);
  assert.match(html, /10:30 AM EST/);
  assert.match(html, /datetime="2026-11-12T15:30:00.000Z"/i);
  assert.equal(html.includes("Referrals:"), false);
  assert.equal(render({ unavailable: true }), "");
  assert.equal(render(undefined), "");
  assert.equal(render({ inventory: null, referrals: null, unavailable: false }), "");
  const referralsOnly = render({ inventory: null, referrals: "2026-11-12T15:30:00.000Z", unavailable: false });
  assert.match(referralsOnly, /Referrals:/);
  assert.equal(referralsOnly.includes("Inventory:"), false);
});
