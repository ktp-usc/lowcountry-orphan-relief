import { JOTFORM_FORMS } from "../jotform/forms.js";
import { normalizeInventorySubmission } from "../jotform/normalize-inventory.js";
import { normalizeReferralSubmission, parseJotformSubmissionDate } from "../jotform/normalize-referral.js";
import { SHEET_MAPPINGS } from "./mappings.js";
import type {
  SheetSource,
  SheetRow,
  NormalizedSheetRecord,
} from "./types.js";

export class SheetValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SheetValidationError";
  }
}

function readValue(row: SheetRow, header: string): string {
  if (!Object.hasOwn(row.values, header) || typeof row.values[header] !== "string") {
    throw new SheetValidationError("COLUMN", `Missing or invalid column: ${header}.`);
  }
  return row.values[header];
}

function mappedAnswers(
  answerHeaders: Readonly<Record<string, string>>,
  row: SheetRow,
): Record<string, { answer: string }> {
  const answers: Record<string, { answer: string }> = {};
  for (const [id, header] of Object.entries(answerHeaders)) {
    answers[id] = { answer: readValue(row, header) };
  }
  return answers;
}

export function normalizeSheetRow(source: SheetSource, row: SheetRow): NormalizedSheetRecord {
  const formId = typeof source.jotformFormId === "string" ? source.jotformFormId.trim() : "";
  const form = JOTFORM_FORMS.find((entry) => entry.id === formId);
  if (!form || form.location !== source.location || form.sourceType !== source.sourceType) {
    throw new SheetValidationError("SOURCE", "Invalid or unsupported source form configuration.");
  }
  const mapping = SHEET_MAPPINGS.find((entry) => entry.key === source.key
    && entry.jotformFormId === formId
    && entry.location === source.location
    && entry.sourceType === source.sourceType
    && entry.submissionIdHeader === source.submissionIdHeader
    && entry.submissionDateHeader === source.submissionDateHeader);
  if (!mapping) throw new SheetValidationError("SOURCE", "Invalid or unsupported source mapping.");
  const id = readValue(row, source.submissionIdHeader).trim();
  if (!/^\d+$/.test(id)) throw new SheetValidationError("SUBMISSION_ID", "Missing or invalid submission ID.");
  if (row.cancelled) {
    return { kind: "cancelled", jotformFormId: formId, jotformSubmissionId: id };
  }
  const dateText = readValue(row, source.submissionDateHeader).trim();
  const timestamp = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}:\d{2})$/.exec(dateText);
  if (!timestamp) throw new SheetValidationError("DATE", "Missing or invalid submission date.");
  let date: Date;
  try {
    date = parseJotformSubmissionDate(`${timestamp[1]} ${timestamp[2].padStart(8, "0")}`);
  } catch {
    throw new SheetValidationError("DATE", "Invalid or ambiguous submission date.");
  }

  if (source.sourceType === "INVENTORY") {
    const answers = mappedAnswers(mapping.answerHeaders, row);
    try {
      return { kind: "active", input: normalizeInventorySubmission(formId, { id, created_at: date, answers }) };
    } catch (error) {
      const field = error instanceof Error ? /Invalid quantity for field (\d+)/.exec(error.message)?.[1] : undefined;
      if (field) throw new SheetValidationError("QUANTITY", `Invalid quantity for inventory field ${field}.`);
      throw error;
    }
  }
  const answers = mappedAnswers(mapping.answerHeaders, row);
  try {
    const input = normalizeReferralSubmission(formId, { id, form_id: formId, created_at: date.toISOString(), answers },
      { requireAgeForChildPajamas: true });
    return { kind: "active", input };
  } catch (error) {
    if (error instanceof Error && /selection is required|valid age selection/.test(error.message)) {
      throw new SheetValidationError("REFERRAL", error.message);
    }
    throw error;
  }
}
