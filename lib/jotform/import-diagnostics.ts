import type { JotformSubmission } from "./fetch-submissions.js";
import type { ImportSummary } from "./import-submissions.js";
import { JOTFORM_FORMS } from "./forms.js";

function answerField(raw: JotformSubmission, id: string) {
  const field = raw.answers?.[id];
  return typeof field === "object" && field !== null && !Array.isArray(field)
    ? field as Record<string, unknown> : {};
}

function fieldState(raw: JotformSubmission, id: string) {
  const field = answerField(raw, id);
  const value = field.answer;
  const knownTypes = ["control_number", "control_radio", "control_dropdown", "control_checkbox", "control_textbox", "control_textarea", "control_datetime", "control_phone", "control_email"];
  return {
    fieldId: id,
    questionType: typeof field.type === "string" && knownTypes.includes(field.type) ? field.type : "unknown",
    answerType: value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    hasAnswer: value !== undefined && value !== null && !(typeof value === "string" && value.trim() === ""),
  };
}

/** Describe numeric shape only; never return the submitted quantity or text. */
function quantityCategory(value: unknown): string {
  if (value === undefined || value === null) return "missing";
  if (typeof value !== "string" && typeof value !== "number") return "unsupported-answer-type";
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text) return "empty";
  if (/^[+-]?\d{1,3}(?:,\d{3})+$/.test(text)) return "comma-grouped-integer";
  if (/^[+-]?\d{1,3}(?:[ \u00a0]\d{3})+$/.test(text)) return "space-grouped-integer";
  const number = Number(text);
  if (!Number.isFinite(number)) return "non-numeric-or-non-finite";
  if (number < 0) return "negative";
  if (!Number.isInteger(number)) return "fractional";
  if (number > 2_147_483_647 || !Number.isSafeInteger(number)) return "outside-database-integer-range";
  return number === 0 ? "zero" : "positive-integer";
}

const clothingTypeFields: Readonly<Record<string, readonly string[]>> = {
  "88": ["90", "93"], "103": ["104", "105"], "110": ["111", "112"],
  "117": ["119"], "126": ["127", "128"], "133": ["134", "135"], "140": ["141", "142"],
};

function recognizedChoice(raw: JotformSubmission, id: string, allowed: readonly string[]) {
  const value = answerField(raw, id).answer;
  return typeof value === "string" && allowed.includes(value.trim().toLowerCase());
}

/** Safe technical diagnostics for captured failures; no answers or personal attributes leave this function. */
export function collectImportDiagnostics(
  captured: ReadonlyMap<string, readonly JotformSubmission[]>,
  errors: ImportSummary["submissionErrors"],
) {
  return errors.map((error) => {
    const identity = { formId: error.formId, submissionId: error.submissionId };
    const raw = captured.get(error.formId)?.find((row) => row.id === error.submissionId);
    if (!raw) return { ...identity, kind: "not-captured" };
    const quantityField = /invalid quantity in field (\d+)/i.exec(error.message)?.[1];
    if (quantityField) {
      return { ...identity, kind: "inventory-quantity", field: fieldState(raw, quantityField),
        quantityCategory: quantityCategory(answerField(raw, quantityField).answer) };
    }
    const clothingField = /missing clothing classification for field (\d+)/i.exec(error.message)?.[1];
    const typeIds = clothingField && Object.hasOwn(clothingTypeFields, clothingField) ? clothingTypeFields[clothingField] : undefined;
    if (clothingField && typeIds) {
      const ids = typeIds.length === 1 ? typeIds : ["17", ...typeIds];
      return { ...identity, kind: "referral-classification", requestField: fieldState(raw, clothingField),
        classificationFields: ids.map((id) => ({ ...fieldState(raw, id),
          recognizedChoice: recognizedChoice(raw, id, id === "17" ? ["male", "female"] : ["adult", "child/baby"]) })) };
    }
    return { ...identity, kind: "other-import-error" };
  });
}

function missingAnswer(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** Confirm specific source-data defects; valid or unsupported shapes still need investigation. */
export function isConfirmedSourceIssue(raw: JotformSubmission, error: ImportSummary["submissionErrors"][number]): boolean {
  const form = JOTFORM_FORMS.find((candidate) => candidate.id === error.formId);
  if (!form || raw.form_id !== form.id || raw.id !== error.submissionId) return false;
  const quantityField = /invalid quantity in field (\d+)/i.exec(error.message)?.[1];
  if (form.sourceType === "INVENTORY" && quantityField) {
    const field = answerField(raw, quantityField);
    return field.type === "control_number" && ["negative", "fractional"].includes(quantityCategory(field.answer));
  }
  const clothingField = /missing clothing classification for field (\d+)/i.exec(error.message)?.[1];
  if (form.sourceType !== "REFERRAL" || !clothingField || !Object.hasOwn(clothingTypeFields, clothingField)) return false;
  if (answerField(raw, clothingField).type !== "control_radio" || !recognizedChoice(raw, clothingField, ["yes"])) return false;
  const typeIds = clothingTypeFields[clothingField];
  let typeId: string;
  if (typeIds.length === 1) typeId = typeIds[0];
  else if (typeIds.length === 2) {
    const sex = answerField(raw, "17").answer;
    if (missingAnswer(sex)) return true;
    if (typeof sex !== "string" || !["male", "female"].includes(sex.trim().toLowerCase())) return false;
    typeId = typeIds[sex.trim().toLowerCase() === "male" ? 0 : 1];
  } else return false;
  return missingAnswer(answerField(raw, typeId).answer);
}
