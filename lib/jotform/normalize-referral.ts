import type { JotformSubmission } from "./fetch-submissions";

type Location = "LOWCOUNTRY" | "MIDLANDS";
type ClothingCategory = "TOPS" | "BOTTOMS" | "JACKETS_HOODIES" | "DRESSES" | "PAJAMAS" | "UNDERWEAR" | "SHOES";
type ClothingRequest = {
  fieldId: string;
  category: ClothingCategory;
  maleTypeFieldId?: string;
  femaleTypeFieldId: string;
};

type ReferralFormMapping = {
  location: Location;
  sexFieldId: string;
  ageFieldId: string;
  clothing: readonly ClothingRequest[];
  socksFieldId: string;
  wipesFieldId: string;
  toiletriesFieldId: string;
  diapersFieldId: string;
  schoolFieldId: string;
  uniformTopsFieldId: string;
  uniformBottomsFieldId: string;
  referralTypeFieldId?: string;
};

// Exact IDs from the supplied field-only exports. Keep independent mappings:
// a future edit to one form must not silently change the other form's mapping.
const referralForms: Readonly<Record<string, ReferralFormMapping>> = {
  "261498369429070": {
    location: "LOWCOUNTRY", sexFieldId: "17", ageFieldId: "158",
    clothing: [
      { fieldId: "88", category: "TOPS", maleTypeFieldId: "90", femaleTypeFieldId: "93" },
      { fieldId: "103", category: "BOTTOMS", maleTypeFieldId: "104", femaleTypeFieldId: "105" },
      { fieldId: "110", category: "JACKETS_HOODIES", maleTypeFieldId: "111", femaleTypeFieldId: "112" },
      { fieldId: "117", category: "DRESSES", femaleTypeFieldId: "119" },
      { fieldId: "126", category: "PAJAMAS", maleTypeFieldId: "127", femaleTypeFieldId: "128" },
      { fieldId: "133", category: "UNDERWEAR", maleTypeFieldId: "134", femaleTypeFieldId: "135" },
      { fieldId: "140", category: "SHOES", maleTypeFieldId: "141", femaleTypeFieldId: "142" },
    ],
    socksFieldId: "147", wipesFieldId: "81", toiletriesFieldId: "85",
    diapersFieldId: "159", schoolFieldId: "83",
    uniformTopsFieldId: "169", uniformBottomsFieldId: "171",
  },
  "261526295444158": {
    location: "MIDLANDS", sexFieldId: "17", ageFieldId: "158",
    clothing: [
      { fieldId: "88", category: "TOPS", maleTypeFieldId: "90", femaleTypeFieldId: "93" },
      { fieldId: "103", category: "BOTTOMS", maleTypeFieldId: "104", femaleTypeFieldId: "105" },
      { fieldId: "110", category: "JACKETS_HOODIES", maleTypeFieldId: "111", femaleTypeFieldId: "112" },
      { fieldId: "117", category: "DRESSES", femaleTypeFieldId: "119" },
      { fieldId: "126", category: "PAJAMAS", maleTypeFieldId: "127", femaleTypeFieldId: "128" },
      { fieldId: "133", category: "UNDERWEAR", maleTypeFieldId: "134", femaleTypeFieldId: "135" },
      { fieldId: "140", category: "SHOES", maleTypeFieldId: "141", femaleTypeFieldId: "142" },
    ],
    socksFieldId: "147", wipesFieldId: "81", toiletriesFieldId: "85",
    diapersFieldId: "159", schoolFieldId: "83",
    uniformTopsFieldId: "169", uniformBottomsFieldId: "171",
    referralTypeFieldId: "178",
  },
};

const defaultQuantities = {
  TOPS: 5, BOTTOMS: 4, JACKETS_HOODIES: 1, DRESSES: 2, PAJAMAS: 1,
  UNDERWEAR: 5, SHOES: 1, SOCKS: 5, WIPES: 1, TOILETRIES: 1,
  DIAPERS: 1, PULL_UPS: 1, SCHOOL: 1, UNIFORM_TOPS: 2, UNIFORM_BOTTOMS: 2,
  BOOKS: 2, STUFFED_ANIMALS: 2,
};

export type ReferralSupply = keyof typeof defaultQuantities;
export type NormalizeReferralOptions = {
  /** Positive whole units per selected request; diapers/pull-ups are packs. */
  quantities?: Partial<Record<ReferralSupply, number>>;
};

/** Same property names and value types as KAN-16's normalization result. */
export type NormalizedReferralResult = {
  submission: {
    jotformFormId: string;
    jotformSubmissionId: string;
    location: Location;
    sourceType: "REFERRAL";
    submissionDate: Date;
  };
  inventoryActivities: {
    itemCode: string;
    quantity: number;
    direction: "OUT";
  }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read only the answer payload; labels, names and arbitrary fields are ignored. */
function answer(answers: Record<string, unknown>, fieldId: string): string {
  const field = answers[fieldId];
  return isRecord(field) && typeof field.answer === "string"
    ? field.answer.trim().toLowerCase() : "";
}

function answerText(answers: Record<string, unknown>, fieldId: string): string {
  const field = answers[fieldId];
  if (!isRecord(field)) return "";
  const value = field.answer;
  if (typeof value === "string") return value.trim().toLowerCase();
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim().toLowerCase()).join(" ");
  }
  return "";
}

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Parse API timestamps deterministically, including Eastern daylight saving time. */
function submissionDate(value: unknown): Date {
  if (typeof value !== "string") throw new Error("A submission timestamp is required.");
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
  if (!match) throw new Error("Invalid submission timestamp.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millis = Number((match[7] ?? "").padEnd(3, "0"));
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const calendar = new Date(wallTime);
  if (year < 1900 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new Error("Invalid submission timestamp.");
  }
  const offset = match[8];
  if (offset) {
    if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) {
      throw new Error("Invalid submission timestamp offset.");
    }
    return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${String(millis).padStart(3, "0")}${offset}`);
  }

  // New York uses UTC-05:00 or UTC-04:00 for dates supported here (1900+).
  // Round-trip both candidates: none means a spring-forward gap; two mean an
  // ambiguous fall-back hour. Require an explicit offset in either case.
  const candidates = [4, 5].map((hours) => new Date(wallTime + hours * 3_600_000)).filter((date) => {
    const parts = Object.fromEntries(newYorkClock.formatToParts(date).map((part) => [part.type, part.value]));
    return Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day
      && Number(parts.hour) === hour && Number(parts.minute) === minute && Number(parts.second) === second;
  });
  if (candidates.length !== 1) {
    throw new Error("Ambiguous or nonexistent America/New_York submission time; provide an explicit UTC offset.");
  }
  return candidates[0];
}

/** Convert only the form's enumerated age options to a toiletry-kit band. */
function toiletryCode(age: string): string {
  if (["0-3 months", "3-6 months", "6-9 months"].includes(age) || age === "1 year") {
    return "TOILETRY_KIT_0_5_YRS";
  }
  const years = /^(\d{1,2}) years$/.exec(age);
  const number = years ? Number(years[1]) : NaN;
  if (number >= 2 && number <= 5) return "TOILETRY_KIT_0_5_YRS";
  if (number >= 6 && number <= 11) return "TOILETRY_KIT_6_11_YRS";
  if (number >= 12 && number <= 18) return "TOILETRY_KIT_12_18_YRS";
  throw new Error("A valid age selection is required for the requested toiletry kit.");
}

function isNineMonthsOrYounger(age: string): boolean {
  return age === "0-3 months" || age === "3-6 months" || age === "6-9 months";
}

/**
 * Transform one KAN-14 API submission into KAN-16's persistence contract.
 * No API calls, database access, logging, input mutation or personal fields in
 * the result. Unselected requests are skipped, even if hidden fields are stale.
 */
export function normalizeReferralSubmission(
  formId: string,
  rawSubmission: JotformSubmission,
  options: NormalizeReferralOptions = {},
): NormalizedReferralResult {
  const normalizedFormId = typeof formId === "string" ? formId.trim() : "";
  const form = Object.hasOwn(referralForms, normalizedFormId) ? referralForms[normalizedFormId] : undefined;
  if (!form) throw new Error("Unsupported referral form ID.");
  if (!isRecord(rawSubmission) || typeof rawSubmission.id !== "string" || !/^\d+$/.test(rawSubmission.id)
    || rawSubmission.form_id !== normalizedFormId) {
    throw new Error("A valid submission ID and matching form_id are required.");
  }
  if (rawSubmission.answers != null && !isRecord(rawSubmission.answers)) {
    throw new Error("Submission answers must be an object.");
  }
  if (!isRecord(options) || (options.quantities !== undefined && !isRecord(options.quantities))) {
    throw new Error("Referral quantity configuration must be an object.");
  }
  const quantities = { ...defaultQuantities, ...options.quantities };
  for (const [key, quantity] of Object.entries(quantities)) {
    if (!Object.hasOwn(defaultQuantities, key) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) {
      throw new Error("Configured referral quantities must be positive PostgreSQL integers for known supplies.");
    }
  }
  const date = submissionDate(rawSubmission.created_at ?? rawSubmission.updated_at);
  const answers = rawSubmission.answers ?? {};
  const selected = (id: string) => answer(answers, id) === "yes";
  const byCode = new Map<string, number>();
  const addUnits = (itemCode: string, units: number) => {
    const quantity = (byCode.get(itemCode) ?? 0) + units;
    if (quantity > 2_147_483_647) throw new Error("Combined referral quantity exceeds the PostgreSQL integer limit.");
    byCode.set(itemCode, quantity);
  };
  const add = (itemCode: string, supply: ReferralSupply) => addUnits(itemCode, quantities[supply]);

  for (const clothing of form.clothing) {
    if (!selected(clothing.fieldId)) continue;
    let typeFieldId = clothing.femaleTypeFieldId;
    let adultPrefix = "WOMENS";
    if (clothing.maleTypeFieldId) {
      const sex = answer(answers, form.sexFieldId);
      if (sex !== "male" && sex !== "female") {
        throw new Error(`A clothing selection is required for requested supply field ${clothing.fieldId}.`);
      }
      if (sex === "male") { typeFieldId = clothing.maleTypeFieldId; adultPrefix = "MENS"; }
    }
    const type = answer(answers, typeFieldId);
    if (type !== "adult" && type !== "child/baby") {
      throw new Error(`An adult or child/baby selection is required for requested supply field ${clothing.fieldId}.`);
    }
    const itemCode = `${type === "adult" ? adultPrefix : "CHILDRENS"}_${clothing.category}`;
    add(itemCode, clothing.category);
    if (clothing.category === "PAJAMAS" && type === "child/baby" && isNineMonthsOrYounger(answer(answers, form.ageFieldId))) {
      // Client rule: selected child/baby pajamas include 3 additional sleepers for 9 months and younger.
      addUnits(itemCode, 3);
    }
  }

  // These referral questions have no adult/child selector. Use the children's
  // IRS categories, counting uniforms as additional tops/bottoms, not colors.
  if (selected(form.socksFieldId)) add("CHILDRENS_SOCKS", "SOCKS");
  if (selected(form.uniformTopsFieldId)) add("CHILDRENS_TOPS", "UNIFORM_TOPS");
  if (selected(form.uniformBottomsFieldId)) add("CHILDRENS_BOTTOMS", "UNIFORM_BOTTOMS");
  if (selected(form.wipesFieldId)) add("WIPES", "WIPES");
  if (selected(form.toiletriesFieldId)) add(toiletryCode(answer(answers, form.ageFieldId)), "TOILETRIES");

  const diaperChoice = answer(answers, form.diapersFieldId);
  if (diaperChoice === "diapers") add("DIAPERS", "DIAPERS");
  if (diaperChoice === "pull ups") add("PULL_UPS", "PULL_UPS");
  const school = answer(answers, form.schoolFieldId);
  if (school === "elementary school bookbag & supplies") add("ELEMENTARY_SCHOOL_BOOKBAG_SUPPLIES", "SCHOOL");
  if (school === "middle/high school bookbag & supplies") add("MIDDLE_HIGH_SCHOOL_BOOKBAG_SUPPLIES", "SCHOOL");

  // Midlands Referral Type (field 178) is a structured selector for additional supplies.
  if (form.referralTypeFieldId) {
    const referralType = answerText(answers, form.referralTypeFieldId);
    if (/\bbooks?\b/.test(referralType)) add("BOOKS", "BOOKS");
    if (/\bstuffed(?:\s+animals?)?\b/.test(referralType) || /\btoys?\b/.test(referralType)) {
      add("STUFFED_ANIMALS", "STUFFED_ANIMALS");
    }
  }

  return {
    submission: {
      jotformFormId: normalizedFormId,
      jotformSubmissionId: rawSubmission.id,
      location: form.location,
      sourceType: "REFERRAL",
      submissionDate: date,
    },
    inventoryActivities: [...byCode].map(([itemCode, quantity]) => ({ itemCode, quantity, direction: "OUT" })),
  };
}
