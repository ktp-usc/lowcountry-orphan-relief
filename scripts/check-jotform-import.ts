import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fetchSubmissions, type InvalidSubmissionIssue, type JotformSubmission } from "../lib/jotform/fetch-submissions.js";
import { JOTFORM_FORMS } from "../lib/jotform/forms.js";
import { importSubmissions, type ImportSummary } from "../lib/jotform/import-submissions.js";
import { collectImportDiagnostics, isConfirmedSourceIssue } from "../lib/jotform/import-diagnostics.js";
import { describeFetchValidationIssue } from "../lib/jotform/import-errors.js";
import { normalizeInventorySubmission, type JotformSubmissionLike } from "../lib/jotform/normalize-inventory.js";
import { normalizeReferralSubmission, parseJotformSubmissionDate } from "../lib/jotform/normalize-referral.js";
import { createImportClient } from "./import-jotform.js";
import { checkImportUsage, parseImportArgs } from "./lib/jotform-import-args.js";

type Client = Awaited<ReturnType<typeof createImportClient>>;
type Key = { jotformFormId: string; jotformSubmissionId: string };
const sortActivities = <T extends { itemCode: string; quantity: number }>(rows: T[]) => rows.toSorted((a, b) => a.itemCode.localeCompare(b.itemCode) || a.quantity - b.quantity);

/** Query valid IDs, including known rejected IDs, without inventing IDs for malformed records. */
export function capturedSampleKeys(captured: ReadonlyMap<string, readonly JotformSubmission[]>, issues: readonly InvalidSubmissionIssue[] = []): Key[] {
  const keys = new Map<string, Key>();
  for (const [formId, rows] of captured) {
    for (const row of rows) keys.set(`${formId}/${row.id}`, { jotformFormId: formId, jotformSubmissionId: row.id });
  }
  for (const issue of issues) {
    if (/^\d+$/.test(issue.submissionId)) {
      keys.set(`${issue.formId}/${issue.submissionId}`, { jotformFormId: issue.formId, jotformSubmissionId: issue.submissionId });
    }
  }
  return [...keys.values()];
}

/** Replay both valid records and fetch-validation failures without another API request. */
export function replayCapturedSample(
  captured: ReadonlyMap<string, JotformSubmission[]>, issues: readonly InvalidSubmissionIssue[] = [],
): typeof fetchSubmissions {
  return async (id, options) => {
    for (const issue of issues) if (issue.formId === id) options?.onInvalidSubmission?.(issue);
    return captured.get(id) ?? [];
  };
}

/** Compare only the bounded selected source keys and their activity rows. */
async function selectedRows(client: Client, keys: Key[]) {
  if (!keys.length) return [];
  return client.sourceSubmission.findMany({
    where: { OR: keys }, orderBy: { id: "asc" },
    include: { inventoryActivities: { orderBy: { id: "asc" }, include: { item: { select: { code: true } } } } },
  });
}

/** Fictional normalization/save failures are isolated in a transaction that always rolls back. */
async function checkFictionalSubmissions(client: Client) {
  const form = JOTFORM_FORMS[0];
  const token = `${Date.now()}${randomUUID().replace(/\D/g, "").slice(0, 12)}`;
  const badId = `990${token}1`, missingCodeId = `990${token}2`, goodId = `990${token}3`;
  const unknownCode = `IMPORT_TEST_${randomUUID().replaceAll("-", "").toUpperCase()}`;
  const makeRaw = (id: string, quantity: string): JotformSubmission => ({
    id, form_id: form.id, created_at: "2026-07-01T12:00:00Z", answers: { "51": { answer: quantity } },
  });
  const keys = [badId, missingCodeId, goodId].map((id) => ({ jotformFormId: form.id, jotformSubmissionId: id }));
  assert.equal((await selectedRows(client, keys)).length, 0, "Fictional test IDs must be unused.");
  const rollback = new Error("ROLL_BACK_FICTIONAL_IMPORT_CHECK");
  let summary: ImportSummary | undefined;
  try {
    await client.$transaction(async (tx) => {
      // Reuse KAN-18 inside this outer test transaction. Its callback receives
      // the real transactional models; no nested database transaction is opened.
      const scoped = {
        $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
      } as unknown as Parameters<typeof importSubmissions>[0];
      summary = await importSubmissions(scoped, { limitPerForm: 3 }, {
        fetchSubmissions: async (id) => id === form.id ? [makeRaw(badId, "-1"), makeRaw(missingCodeId, "2"), makeRaw(goodId, "3")] : [],
        normalizeInventory: (id, raw) => {
          const result = normalizeInventorySubmission(id, raw as JotformSubmissionLike);
          if (raw.id === missingCodeId) result.inventoryActivities[0].itemCode = unknownCode;
          return result;
        },
      });
      assert.equal(summary.saved, 1); assert.equal(summary.skipped, 0); assert.equal(summary.failed, 2);
      assert.deepEqual(summary.formErrors, []);
      assert.deepEqual(summary.submissionErrors.map((error) => error.submissionId), [badId, missingCodeId]);
      const sources = await tx.sourceSubmission.findMany({ where: { OR: keys }, include: { inventoryActivities: { include: { item: true } } } });
      assert.equal(sources.length, 1); assert.equal(sources[0].jotformSubmissionId, goodId);
      assert.equal(sources[0].inventoryActivities.length, 1);
      assert.equal(sources[0].inventoryActivities[0].item.code, "WIPES");
      assert.equal(sources[0].inventoryActivities[0].quantity, 3);
      assert.equal(sources[0].inventoryActivities[0].direction, "IN");
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal((await selectedRows(client, keys)).length, 0, "Fictional source rows were not rolled back.");
  assert.equal(await client.inventoryActivity.count({ where: { OR: keys } }), 0, "Fictional activities were not rolled back.");
  assert.ok(summary, "The fictional check did not run.");
  return summary;
}

/** Verify successful rows and rejected-row absence before assessing sample completeness. */
export function verifyCapturedRows(
  captured: ReadonlyMap<string, readonly JotformSubmission[]>,
  first: ImportSummary,
  second: ImportSummary,
  beforeSecond: Awaited<ReturnType<typeof selectedRows>>,
  afterSecond: Awaited<ReturnType<typeof selectedRows>>,
  fetchIssues: readonly InvalidSubmissionIssue[] = [],
) {
  const keys = [...captured].flatMap(([formId, rows]) => rows.map((row) => `${formId}/${row.id}`));
  const normalizationErrors = [...first.submissionErrors];
  for (const issue of fetchIssues) {
    const message = describeFetchValidationIssue(issue);
    const index = normalizationErrors.findIndex((error) => error.formId === issue.formId && error.submissionId === issue.submissionId && error.message === message);
    assert.ok(index >= 0, "A malformed API record was not included in the submission error summary.");
    normalizationErrors.splice(index, 1);
  }
  const rejected = new Set(normalizationErrors.map((error) => `${error.formId}/${error.submissionId}`));
  assert.equal(first.failed, first.submissionErrors.length);
  assert.equal(rejected.size, normalizationErrors.length);
  assert.equal(first.saved + first.skipped + first.failed, keys.length + fetchIssues.length);
  assert.equal(second.saved, 0);
  assert.equal(second.failed, first.failed);
  assert.equal(second.skipped, first.saved + first.skipped);
  assert.deepEqual(second.formErrors, []);
  assert.deepEqual(second.submissionErrors, first.submissionErrors, "The same sample produced different submission failures.");
  assert.deepEqual(afterSecond, beforeSecond, "The repeat import changed persisted rows.");
  assert.equal(afterSecond.length, keys.length - rejected.size);

  for (const form of JOTFORM_FORMS) {
    for (const raw of captured.get(form.id) ?? []) {
      const source = afterSecond.find((row) => row.jotformFormId === form.id && row.jotformSubmissionId === raw.id);
      if (rejected.has(`${form.id}/${raw.id}`)) {
        assert.equal(source, undefined, `Rejected submission has database rows: ${form.id}/${raw.id}.`);
        continue;
      }
      const expected = form.sourceType === "REFERRAL" ? normalizeReferralSubmission(form.id, raw)
        : normalizeInventorySubmission(form.id, { ...raw, created_at: parseJotformSubmissionDate(raw.created_at ?? raw.updated_at) } as JotformSubmissionLike);
      assert.ok(source, `Missing imported source ${form.id}/${raw.id}.`);
      assert.equal(source.location, form.location); assert.equal(source.sourceType, form.sourceType);
      assert.equal(source.submissionDate.toISOString(), expected.submission.submissionDate.toISOString());
      assert.deepEqual(sortActivities(source.inventoryActivities.map((activity) => ({ itemCode: activity.item.code, quantity: activity.quantity, direction: activity.direction }))), sortActivities(expected.inventoryActivities));
      for (const activity of source.inventoryActivities) {
        assert.equal(activity.jotformFormId, form.id); assert.equal(activity.jotformSubmissionId, raw.id);
      }
    }
  }
  const validKeys = new Set(keys);
  for (const issue of fetchIssues) {
    if (issue.submissionId !== "unknown" && !validKeys.has(`${issue.formId}/${issue.submissionId}`)) {
      assert.equal(afterSecond.some((row) => row.jotformFormId === issue.formId && row.jotformSubmissionId === issue.submissionId), false,
        "A malformed API record has persisted source rows.");
    }
  }
  return { verifiedSubmissions: afterSecond.length, rejectedSubmissions: first.failed, repeatUnchanged: true };
}

/** Require four-form coverage and both save paths; only confirmed source defects may remain rejected. */
export function assessSampleOutcome(
  captured: ReadonlyMap<string, readonly JotformSubmission[]>,
  first: ImportSummary,
  verifiedRows: Awaited<ReturnType<typeof selectedRows>>,
  fetchIssues: readonly InvalidSubmissionIssue[] = [],
) {
  assert.deepEqual(first.formErrors, [], "A real form could not be fetched.");
  for (const form of JOTFORM_FORMS) {
    const count = (captured.get(form.id)?.length ?? 0) + fetchIssues.filter((issue) => issue.formId === form.id).length;
    assert.ok(count, `No real sample was returned for form ${form.id}.`);
  }
  assert.equal(first.failed, first.submissionErrors.length);
  const unexpected = first.submissionErrors.filter((error) => {
    const raw = captured.get(error.formId)?.find((row) => row.id === error.submissionId);
    return !raw || !isConfirmedSourceIssue(raw, error);
  });
  assert.deepEqual(unexpected, [], "Unexpected import failures remain; inspect the source diagnostics and database configuration.");
  assert.ok(verifiedRows.length, "The sample must include successfully persisted real submissions.");
  assert.equal(first.saved + first.skipped, verifiedRows.length);
  for (const sourceType of ["INVENTORY", "REFERRAL"]) {
    assert.ok(verifiedRows.some((row) => row.sourceType === sourceType), `The sample must verify persisted ${sourceType} submissions.`);
  }
  return {
    status: first.failed ? "passed-with-source-data-issues" : "passed",
    verifiedSubmissions: verifiedRows.length,
    rejectedSubmissions: first.failed,
    sourceReviewRequired: first.failed > 0,
  };
}

/** Import a small real sample twice, verify persisted values, then test rollback/continuation separately. */
export async function checkJotformImport(args = process.argv.slice(2)) {
  const options = parseImportArgs(args, true);
  if (options.help) { console.log(checkImportUsage); return; }
  const client = await createImportClient();
  try {
    const captured = new Map<string, JotformSubmission[]>();
    const fetchIssues: InvalidSubmissionIssue[] = [];
    const first = await importSubmissions(client, options, {
      fetchSubmissions: async (id, fetchOptions) => {
        const rows = await fetchSubmissions(id, { ...fetchOptions, onInvalidSubmission: (issue) => {
          fetchIssues.push(issue);
          fetchOptions?.onInvalidSubmission?.(issue);
        } });
        captured.set(id, rows);
        return rows;
      },
    });
    console.log(JSON.stringify({ pass: 1, ...first }, null, 2));
    const keys = capturedSampleKeys(captured, fetchIssues);
    const sampledCount = [...captured.values()].reduce((count, rows) => count + rows.length, fetchIssues.length);
    const beforeSecond = await selectedRows(client, keys);
    const second = await importSubmissions(client, options, { fetchSubmissions: replayCapturedSample(captured, fetchIssues) });
    console.log(JSON.stringify({ pass: 2, ...second }, null, 2));
    if (first.submissionErrors.length) {
      console.log(JSON.stringify({ sourceDiagnostics: collectImportDiagnostics(captured, first.submissionErrors) }, null, 2));
    }
    const afterSecond = await selectedRows(client, keys);
    const fictional = await checkFictionalSubmissions(client);
    console.log(JSON.stringify({ check: "separate fictional submissions; all test writes rolled back", ...fictional }, null, 2));

    console.log(JSON.stringify({ databaseVerification: verifyCapturedRows(captured, first, second, beforeSecond, afterSecond, fetchIssues) }, null, 2));
    const outcome = assessSampleOutcome(captured, first, afterSecond, fetchIssues);
    console.log(JSON.stringify({ importVerification: outcome }, null, 2));
    if (outcome.sourceReviewRequired) {
      console.log(`SOURCE DATA: ${first.failed} submissions remain failed and require source review; see submissionErrors and sourceDiagnostics above.`);
    }
    console.log(`PASS: import behavior verified for ${sampledCount} sampled submissions across four forms (${outcome.verifiedSubmissions} persisted, ${outcome.rejectedSubmissions} rejected for confirmed source-data issues); repeat import changed no rows; separate fictional failures continued to a valid submission and left no test rows.`);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkJotformImport().catch((error: unknown) => {
    console.error(error instanceof assert.AssertionError ? error.message : "Live import check failed. Review the summaries above, command arguments, Jotform key, seeded catalogue and database configuration.");
    process.exitCode = 1;
  });
}
