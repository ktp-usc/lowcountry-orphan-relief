import { JOTFORM_FORMS } from "../jotform/forms.js";
import { normalizeInventorySubmission } from "../jotform/normalize-inventory.js";
import { normalizeReferralSubmission, parseJotformSubmissionDate } from "../jotform/normalize-referral.js";
import type {
  SheetSource,
  SheetRow,
  NormalizedSheetRecord,
} from "./types.js";
import type { ColumnReference } from "./types.js";

export class SheetValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SheetValidationError";
  }
}

function readColumn(row: SheetRow, column: ColumnReference): string {
  let index: number;
  if ("header" in column) {
    index = row.headers.indexOf(column.header);
    if (index < 0 || row.headers.lastIndexOf(column.header) !== index) {
      throw new SheetValidationError("COLUMN", `Missing or ambiguous column: ${column.header}.`);
    }
  } else {
    index = column.index;
    if (!Number.isInteger(index) || index < 0 || row.headers[index] !== column.expectedHeader) {
      throw new SheetValidationError("COLUMN", "Configured indexed column does not match the source layout.");
    }
  }
  if (typeof row.values[index] !== "string") {
    throw new SheetValidationError("COLUMN", "Row has a missing cell.");
  }
  return row.values[index];
}

const genderSelectors = [
  ["88", "90", "93"], ["103", "104", "105"], ["110", "111", "112"],
  ["126", "127", "128"], ["133", "134", "135"], ["140", "141", "142"],
  ["147", "141", "142"], ["169", "90", "93"], ["171", "104", "105"],
] as const;

function referralAnswers(source: SheetSource, row: SheetRow): Record<string, { answer: string }> {
  const answers: Record<string, { answer: string }> = {};
  for (const [id, reference] of Object.entries(source.answers)) {
    answers[id] = { answer: readColumn(row, reference) };
  }
  const genders = new Set<string>();
  for (const [request, male, female] of genderSelectors) {
    if (answers[request]?.answer.trim().toLowerCase() !== "yes") continue;
    for (const [id, gender] of [[male, "Male"], [female, "Female"]]) {
      if (answers[id]?.answer.trim()) genders.add(gender);
    }
  }
  if (genders.size > 1) {
    throw new SheetValidationError("CLASSIFICATION", "Conflicting referral classification selectors.");
  }
  answers["17"] = { answer: [...genders][0] ?? "" };
  return answers;
}

export function normalizeSheetRow(source: SheetSource, row: SheetRow): NormalizedSheetRecord {
  const formId = typeof source.jotformFormId === "string" ? source.jotformFormId.trim() : "";
  const form = JOTFORM_FORMS.find((entry) => entry.id === formId);
  if (!form || form.location !== source.location || form.sourceType !== source.sourceType) {
    throw new SheetValidationError("SOURCE", "Invalid or unsupported source form configuration.");
  }
  const id = readColumn(row, source.submissionId).trim();
  if (!/^\d+$/.test(id)) throw new SheetValidationError("SUBMISSION_ID", "Missing or invalid submission ID.");
  if (source.cancellation) {
    const status = readColumn(row, source.cancellation.column).trim().toLowerCase();
    if (source.cancellation.cancelledValues.some((value) => value.trim().toLowerCase() === status)) {
      return { kind: "cancelled", jotformFormId: formId, jotformSubmissionId: id };
    }
    if (source.cancellation.activeValues && !source.cancellation.activeValues.some((value) => value.trim().toLowerCase() === status)) {
      throw new SheetValidationError("STATUS", "Invalid cancellation status.");
    }
  }
  if (!source.submissionDate) throw new SheetValidationError("DATE", "Submission date column unresolved.");
  const dateText = readColumn(row, source.submissionDate).trim();
  const timestamp = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}:\d{2})$/.exec(dateText);
  if (!timestamp) throw new SheetValidationError("DATE", "Missing or invalid submission date.");
  let date: Date;
  try {
    date = parseJotformSubmissionDate(`${timestamp[1]} ${timestamp[2].padStart(8, "0")}`);
  } catch {
    throw new SheetValidationError("DATE", "Invalid or ambiguous submission date.");
  }

  if (source.sourceType === "INVENTORY") {
    const answers: Record<string, { answer: string }> = {};
    for (const [fieldId, reference] of Object.entries(source.answers)) answers[fieldId] = { answer: readColumn(row, reference) };
    try {
      return { kind: "active", input: normalizeInventorySubmission(formId, { id, created_at: date, answers }) };
    } catch (error) {
      const field = error instanceof Error ? /Invalid quantity for field (\d+)/.exec(error.message)?.[1] : undefined;
      if (field) throw new SheetValidationError("QUANTITY", `Invalid quantity for inventory field ${field}.`);
      throw error;
    }
  }
  const answers = referralAnswers(source, row);
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
