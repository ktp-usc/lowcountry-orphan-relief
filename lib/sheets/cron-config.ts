import { SHEET_SOURCES } from "./sources.js";

// Increase only after measuring, and update vercel.json in the same change.
export const SHEET_SYNC_BUCKET_COUNTS: Readonly<Record<string, number>> = {
  "lor-inventory": 1,
  "mor-inventory": 1,
  "lor-referral": 1,
  "mor-referral": 1,
};

export function configuredSheetJob(sourceKey: string, bucket: string) {
  const count = SHEET_SYNC_BUCKET_COUNTS[sourceKey];
  const source = SHEET_SOURCES.find((entry) => entry.key === sourceKey);
  if (!source || !count || !/^(0|[1-9]\d*)$/.test(bucket)) return undefined;
  const index = Number(bucket);
  if (!Number.isSafeInteger(index) || index >= count) return undefined;
  return { source, bucket: { index, count } };
}

export function belongsToBucket(id: string, bucket: { index: number; count: number }): boolean {
  return BigInt(id) % BigInt(bucket.count) === BigInt(bucket.index);
}
