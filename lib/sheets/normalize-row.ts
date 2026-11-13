import { JOTFORM_FORMS } from "../jotform/forms.js";
import { normalizeInventorySubmission } from "../jotform/normalize-inventory.js";
import { normalizeReferralSubmission, parseJotformSubmissionDate } from "../jotform/normalize-referral.js";
import {
  SHEET_MAPPINGS,
  REFERRAL_CLASSIFICATIONS,
} from "./mappings.js";
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

function fillMissingReferralTypes(
  row: SheetRow,
  original: Record<string, { answer: string }>,
) {
  const answers = { ...original };
  const inferred: string[] = [];
  const sex = answers["17"]?.answer.trim().toLowerCase();

  if (sex !== "male" && sex !== "female") {
    return { answers, inferred };
  }

  const selected = (id: string) =>
    answers[id]?.answer.trim().toLowerCase() === "yes";

  const cell = (header: string) => {
    const entry = Object.entries(row.values).find(
      ([key]) => key.trim().toLowerCase() === header.toLowerCase(),
    );

    return entry?.[1].trim().toLowerCase() ?? "";
  };

  const hasSize = (header: string) => {
    const value = cell(header);
    return value !== "" && !["none", "no", "n/a"].includes(value);
  };

  const hints = REFERRAL_CLASSIFICATIONS.map(
    ([item, requestId, maleTypeId, femaleTypeId]) => {
      const typeId =
        maleTypeId && sex === "male" ? maleTypeId : femaleTypeId;

      const supplied = answers[typeId]?.answer.trim().toLowerCase() ?? "";
      const sexes = maleTypeId ? ["Male", "Female"] : ["Female"];

      const anyAdult = sexes.some((label) =>
        hasSize(`Adult ${label} ${item} Size`),
      );
      const anyChild = sexes.some((label) =>
        hasSize(`Child ${label} ${item} Size`),
      );

      const matchingSex = sex === "male" ? "Male" : "Female";
      const matchingAdult = hasSize(
        `Adult ${matchingSex} ${item} Size`,
      );

      let evidence: string | undefined;

      if (supplied === "adult" || supplied === "child/baby") {
        evidence = supplied;
      } else if (supplied === "") {
        // Child categories are shared across male/female sizes.
        if (anyChild && !anyAdult) evidence = "child/baby";
        if (matchingAdult && !anyChild) evidence = "adult";
      }

      return { item, requestId, typeId, supplied, evidence };
    },
  );

  // Socks and uniforms share the type of their corresponding clothing category,
  // even when that base clothing item was not requested.
  const needed = (hint: (typeof hints)[number]) =>
    selected(hint.requestId) ||
    (hint.item === "Shoes" && selected("147")) ||
    (hint.item === "Tops" && selected("169")) ||
    (hint.item === "Bottoms" && selected("171"));

  // Only requested categories establish agreement; unused answers may be stale.
  const otherEvidence = new Set(
    hints
      .filter(needed)
      .map((hint) => hint.evidence)
      .filter((value): value is string => value !== undefined),
  );

  const agreed =
    otherEvidence.size === 1 ? [...otherEvidence][0] : undefined;

  for (const hint of hints) {
    // Preserve explicit types, including invalid ones for validation.
    if (!needed(hint) || hint.supplied !== "") continue;

    const fallback = hint.evidence ?? agreed;
    if (!fallback) continue;

    answers[hint.typeId] = {
      answer: fallback === "adult" ? "Adult" : "Child/Baby",
    };
    inferred.push(hint.item);
  }

  return { answers, inferred };
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
  const { answers, inferred } = fillMissingReferralTypes(
    row,
    mappedAnswers(mapping.answerHeaders, row),
  );

  try {
    const input = normalizeReferralSubmission(
      formId,
      {
        id,
        form_id: formId,
        created_at: date.toISOString(),
        answers,
      },
      { requireAgeForChildPajamas: true },
    );

    if (inferred.length > 0) {
      console.warn(
        `${source.key}: submission ${id}, row ${row.rowNumber}: ` +
        `inferred classifications for ${inferred.join(", ")}.`,
      );
    }

    return { kind: "active", input };
  } catch (error) {
    if (error instanceof Error && /selection is required|valid age selection/.test(error.message)) {
      throw new SheetValidationError("REFERRAL", error.message);
    }
    throw error;
  }
}
