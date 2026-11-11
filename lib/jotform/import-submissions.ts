import { saveSubmission, type SubmissionSaveInput } from "../inventory/save-submission.js";
import { fetchSubmissions, type JotformSubmission } from "./fetch-submissions.js";
import { JOTFORM_FORMS } from "./forms.js";
import { describeFetchValidationIssue, describeImportError } from "./import-errors.js";
import { normalizeInventorySubmission, type JotformSubmissionLike } from "./normalize-inventory.js";
import { normalizeReferralSubmission, parseJotformSubmissionDate } from "./normalize-referral.js";

export type ImportSummary = {
  saved: number;
  skipped: number;
  failed: number;
  formErrors: { formId: string; message: string }[];
  submissionErrors: { formId: string; submissionId: string; message: string }[];
};

export type ImportOptions = {
  /** Maximum source records per form, including malformed entries; omitted means all. */
  limitPerForm?: number;
};

type NormalizeSubmission = (formId: string, submission: JotformSubmission) => SubmissionSaveInput;
export type ImportDependencies = {
  fetchSubmissions: typeof fetchSubmissions;
  normalizeInventory: NormalizeSubmission;
  normalizeReferral: NormalizeSubmission;
  saveSubmission: typeof saveSubmission;
};

const defaultDependencies: ImportDependencies = {
  fetchSubmissions,
  // KAN-14 accepts arbitrary API answer payloads. KAN-16 validates only the
  // configured inventory fields when adapting that payload to its input type.
  normalizeInventory: (id, raw) => normalizeInventorySubmission(id, {
    ...raw,
    // KAN-16 accepts Date values. Reuse the referral account-time parser so
    // inventory imports also remain independent of the machine's timezone.
    created_at: parseJotformSubmissionDate(raw.created_at ?? raw.updated_at),
  } as JotformSubmissionLike),
  normalizeReferral: normalizeReferralSubmission,
  saveSubmission,
};

/** Import configured forms sequentially; a failed form/submission never stops later ones. */
export async function importSubmissions(
  client: Parameters<typeof saveSubmission>[0],
  { limitPerForm }: ImportOptions = {},
  overrides: Partial<ImportDependencies> = {},
): Promise<ImportSummary> {
  if (limitPerForm !== undefined && (!Number.isSafeInteger(limitPerForm) || limitPerForm < 1)) {
    throw new Error("limitPerForm must be a positive safe integer.");
  }
  const dependencies = { ...defaultDependencies, ...overrides };
  const summary: ImportSummary = { saved: 0, skipped: 0, failed: 0, formErrors: [], submissionErrors: [] };

  for (const form of JOTFORM_FORMS) {
    let submissions: JotformSubmission[];
    let invalidRecords = 0;
    try {
      submissions = await dependencies.fetchSubmissions(form.id, {
        maxSubmissions: limitPerForm,
        onInvalidSubmission: (issue) => {
          if (limitPerForm !== undefined && invalidRecords >= limitPerForm) return;
          invalidRecords++;
          summary.failed++;
          summary.submissionErrors.push({ formId: form.id, submissionId: issue.submissionId, message: describeFetchValidationIssue(issue) });
        },
      });
    } catch (error) {
      summary.formErrors.push({ formId: form.id, message: describeImportError(error, "fetch") });
      continue;
    }
    const selected = limitPerForm === undefined ? submissions : submissions.slice(0, Math.max(0, limitPerForm - invalidRecords));
    for (const raw of selected) {
      // IDs are strings throughout; never coerce Jotform's large integers to Number.
      const id = raw && typeof raw.id === "string" && /^\d+$/.test(raw.id) ? raw.id : "unknown";
      let stage: "normalize" | "save" = "normalize";
      try {
        if (id === "unknown" || raw.form_id !== form.id) {
          throw new Error("A valid submission ID and matching form_id are required.");
        }
        const normalize = form.sourceType === "INVENTORY" ? dependencies.normalizeInventory : dependencies.normalizeReferral;
        const input = normalize(form.id, raw);
        const metadata = input.submission;
        const hasInvalidDirection = input.inventoryActivities.some((activity) =>
          form.sourceType === "INVENTORY" ? !["IN", "OUT"].includes(activity.direction) : activity.direction !== "OUT");
        if (metadata.jotformFormId !== form.id || metadata.jotformSubmissionId !== id
          || metadata.location !== form.location || metadata.sourceType !== form.sourceType
          || hasInvalidDirection) {
          throw new Error("Normalization does not match the configured form.");
        }
        if (!(metadata.submissionDate instanceof Date) || Number.isNaN(metadata.submissionDate.getTime())) {
          throw new Error("Invalid submission date.");
        }
        stage = "save";
        const result = await dependencies.saveSubmission(client, input);
        if (result.status === "saved") summary.saved++;
        else if (result.status === "skipped") summary.skipped++;
        else throw new Error("Unexpected save result.");
      } catch (error) {
        summary.failed++;
        summary.submissionErrors.push({ formId: form.id, submissionId: id, message: describeImportError(error, stage) });
      }
    }
  }
  return summary;
}
