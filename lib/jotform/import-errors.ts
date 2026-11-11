import type { InvalidSubmissionIssue } from "./fetch-submissions.js";

type ImportStage = "fetch" | "normalize" | "save";

/** Fixed descriptions only: malformed payloads must never appear in summaries. */
export function describeFetchValidationIssue(issue: InvalidSubmissionIssue): string {
  const reasons: Record<InvalidSubmissionIssue["reason"], string> = {
    "not-an-object": "submission must be a JSON object",
    "invalid-id": "submission ID must be a numeric string",
    "wrong-form": "submission form ID does not match the requested form",
    "invalid-created-at": "created_at must be a string, null or absent",
    "invalid-updated-at": "updated_at must be a string, null or absent",
    "invalid-answers": "answers must be an object, null or absent",
  };
  return `Fetch validation failed at record ${issue.recordIndex + 1}: ${reasons[issue.reason]}.`;
}

/** Describe known failures without printing answers, credentials or Prisma queries. */
export function describeImportError(error: unknown, stage: ImportStage): string {
  const message = error instanceof Error ? error.message : "";
  if (stage === "fetch") {
    const offset = /offset (\d+):/.exec(message)?.[1];
    const status = /(?:HTTP |API response code )(\d{3})\b/.exec(message)?.[1];
    const context = offset ? ` at offset ${offset}` : "";
    if (status) return `Fetching failed${context}: Jotform returned status ${status}.`;
    if (/timed out/i.test(message)) return `Fetching failed${context}: the request timed out.`;
    if (/Pagination made no progress/.test(message)) return `Fetching failed${context}: pagination made no progress.`;
    if (/JOTFORM_API_KEY/.test(message)) return "Fetching failed: configure JOTFORM_API_KEY with read access to this form.";
    if (/JOTFORM_API_BASE_URL/.test(message)) return "Fetching failed: configure a supported Jotform API region.";
    return `Fetching failed${context}: unable to retrieve valid submissions for this form.`;
  }
  if (stage === "normalize") {
    const field = /(?:Invalid quantity for field|requested supply field) (\d+)\b/.exec(message)?.[1];
    if (/Invalid quantity/.test(message)) return `Normalization failed: invalid quantity${field ? ` in field ${field}` : ""}; expected a positive whole number or zero to omit.`;
    if (/timestamp|submission time|submission date/i.test(message)) return "Normalization failed: invalid, missing or ambiguous submission timestamp.";
    if (/valid age/.test(message)) return "Normalization failed: the requested toiletry kit needs a valid age selection.";
    if (/selection is required/.test(message)) return `Normalization failed: missing clothing classification${field ? ` for field ${field}` : ""}.`;
    if (/matching form_id|submission ID|submission id/i.test(message)) return "Normalization failed: invalid submission ID or mismatched form ID.";
    if (/configured form/.test(message)) return "Normalization failed: result metadata or activity direction does not match the configured form.";
    return "Normalization failed: the submission could not be converted to inventory activities.";
  }
  const codes = /^No Item rows found for codes: ([A-Z0-9_, ]+)\. Submission was not saved\.$/.exec(message)?.[1];
  if (codes) return `Saving failed: item codes are missing from the catalogue: ${codes.slice(0, 250)}.`;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return /^P\d{4}$/.test(code)
    ? `Saving failed: database error ${code}; the submission was not imported.`
    : "Saving failed: the database could not save this submission.";
}
