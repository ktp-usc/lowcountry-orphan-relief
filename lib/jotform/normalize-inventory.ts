export const Location = {
  LOWCOUNTRY: 'LOWCOUNTRY',
  MIDLANDS: 'MIDLANDS',
} as const;

export const SourceType = {
  INVENTORY: 'INVENTORY',
  REFERRAL: 'REFERRAL',
} as const;

export const InventoryDirection = {
  IN: 'IN',
  OUT: 'OUT',
} as const;

export type LocationValue = (typeof Location)[keyof typeof Location];
export type SourceTypeValue = (typeof SourceType)[keyof typeof SourceType];
export type InventoryDirectionValue =
  (typeof InventoryDirection)[keyof typeof InventoryDirection];

type PrimitiveAnswer = string | number | boolean | null | undefined;

type JotformAnswerValue = PrimitiveAnswer | {
  answer?: PrimitiveAnswer;
  text?: PrimitiveAnswer;
  value?: PrimitiveAnswer;
  name?: string;
};

export type JotformSubmissionLike = {
  id?: string | number | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  answers?: Record<string, JotformAnswerValue>;
};

export type NormalizedSourceSubmission = {
  jotformFormId: string;
  jotformSubmissionId: string;
  location: LocationValue;
  sourceType: SourceTypeValue;
  submissionDate: Date;
};

export type NormalizedInventoryActivity = {
  itemCode: string;
  quantity: number;
  direction: InventoryDirectionValue;
};

export type NormalizedInventoryResult = {
  submission: NormalizedSourceSubmission;
  inventoryActivities: NormalizedInventoryActivity[];
};

type InventoryFormConfig = {
  location: LocationValue;
  itemCodeByFieldId: Record<string, string>;
};

const INVENTORY_FORM_MAPPINGS: Record<string, InventoryFormConfig> = {
  '241895593214161': {
    location: Location.LOWCOUNTRY,
    itemCodeByFieldId: {
      '8': 'MENS_TOPS',
      '49': 'DIAPERS',
      '50': 'PULL_UPS',
      '51': 'WIPES',
      '52': 'STUFFED_ANIMALS',
      '53': 'BOOKS',
      '54': 'BABY_BLANKET',
      '61': 'TOILETRY_KIT_0_5_YRS',
      '62': 'TOILETRY_KIT_6_11_YRS',
      '63': 'TOILETRY_KIT_12_18_YRS',
      '64': 'ELEMENTARY_SCHOOL_BOOKBAG_SUPPLIES',
      '65': 'MIDDLE_HIGH_SCHOOL_BOOKBAG_SUPPLIES',
      '70': 'MENS_BOTTOMS',
      '79': 'MENS_JACKETS_HOODIES',
      '82': 'MENS_PAJAMAS',
      '85': 'MENS_SOCKS',
      '88': 'MENS_UNDERWEAR',
      '91': 'MENS_SHOES',
      '94': 'WOMENS_TOPS',
      '97': 'WOMENS_BOTTOMS',
      '106': 'WOMENS_DRESSES',
      '109': 'WOMENS_PAJAMAS',
      '112': 'WOMENS_SOCKS',
      '115': 'WOMENS_UNDERWEAR',
      '118': 'WOMENS_SHOES',
      '121': 'WOMENS_JACKETS_HOODIES',
      '124': 'CHILDRENS_TOPS',
      '127': 'CHILDRENS_BOTTOMS',
      '136': 'CHILDRENS_DRESSES',
      '139': 'CHILDRENS_JACKETS_HOODIES',
      '142': 'CHILDRENS_PAJAMAS',
      '145': 'CHILDRENS_SOCKS',
      '148': 'CHILDRENS_UNDERWEAR',
      '151': 'CHILDRENS_SHOES',
    },
  },
  '250054265404145': {
    location: Location.MIDLANDS,
    itemCodeByFieldId: {
      '8': 'MENS_TOPS',
      '49': 'DIAPERS',
      '50': 'PULL_UPS',
      '51': 'WIPES',
      '52': 'STUFFED_ANIMALS',
      '53': 'BOOKS',
      '54': 'BABY_BLANKET',
      '61': 'TOILETRY_KIT_0_5_YRS',
      '62': 'TOILETRY_KIT_6_11_YRS',
      '63': 'TOILETRY_KIT_12_18_YRS',
      '64': 'ELEMENTARY_SCHOOL_BOOKBAG_SUPPLIES',
      '65': 'MIDDLE_HIGH_SCHOOL_BOOKBAG_SUPPLIES',
      '70': 'MENS_BOTTOMS',
      '79': 'MENS_JACKETS_HOODIES',
      '82': 'MENS_PAJAMAS',
      '85': 'MENS_SOCKS',
      '88': 'MENS_UNDERWEAR',
      '91': 'MENS_SHOES',
      '94': 'WOMENS_TOPS',
      '97': 'WOMENS_BOTTOMS',
      '106': 'WOMENS_DRESSES',
      '109': 'WOMENS_PAJAMAS',
      '112': 'WOMENS_SOCKS',
      '115': 'WOMENS_UNDERWEAR',
      '118': 'WOMENS_SHOES',
      '121': 'WOMENS_JACKETS_HOODIES',
      '124': 'CHILDRENS_TOPS',
      '127': 'CHILDRENS_BOTTOMS',
      '136': 'CHILDRENS_DRESSES',
      '139': 'CHILDRENS_JACKETS_HOODIES',
      '142': 'CHILDRENS_PAJAMAS',
      '145': 'CHILDRENS_SOCKS',
      '148': 'CHILDRENS_UNDERWEAR',
      '151': 'CHILDRENS_SHOES',
    },
  },
};

function normalizeFormId(formId: string | number): string {
  return String(formId ?? '').trim();
}

function getInventoryFormConfig(formId: string | number): InventoryFormConfig {
  const normalized = normalizeFormId(formId);
  const match = INVENTORY_FORM_MAPPINGS[normalized];

  if (!match) {
    throw new Error(
      `No inventory form mapping configured for form ID ${normalized}. Add a mapping for the form before normalizing.`,
    );
  }

  return match;
}

function toDate(value: string | Date | null | undefined, label: string): Date {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Missing required ${label}.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }

  return date;
}

function adaptAnswerObject(value: Record<string, unknown>): string | number | boolean | null {
  const answerValue = value.answer ?? null;

  if (answerValue === null || answerValue === undefined || answerValue === '') {
    return null;
  }

  if (typeof answerValue === 'string' || typeof answerValue === 'number' || typeof answerValue === 'boolean') {
    return answerValue;
  }

  return String(answerValue);
}

function extractAnswerValue(value: JotformAnswerValue): string | number | boolean | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    const adapted = adaptAnswerObject(value as Record<string, unknown>);
    return adapted;
  }

  return value;
}

function parseQuantity(value: JotformAnswerValue): number | null {
  const extracted = extractAnswerValue(value);
  if (extracted === null) {
    return null;
  }

  if (typeof extracted === 'boolean') {
    throw new Error('Invalid quantity value: booleans are not supported.');
  }

  const numeric = typeof extracted === 'number' ? extracted : Number(String(extracted).trim());

  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid quantity value: ${String(extracted)}`);
  }

  if (numeric === 0) {
    return null;
  }

  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid quantity value: ${String(extracted)}`);
  }

  return numeric;
}

function resolveSubmissionId(submission: JotformSubmissionLike): string {
  const submissionId = String(submission?.id ?? '').trim();
  if (!submissionId) {
    throw new Error('Missing required submission id.');
  }

  return submissionId;
}

function resolveSubmissionDate(submission: JotformSubmissionLike): Date {
  const timestamp = submission?.created_at ?? submission?.updated_at ?? submission?.createdAt ?? submission?.updatedAt;
  return toDate(timestamp, 'submission timestamp');
}

export function normalizeInventorySubmission(
  formId: string | number,
  submission: JotformSubmissionLike,
): NormalizedInventoryResult {
  const config = getInventoryFormConfig(formId);
  const submissionId = resolveSubmissionId(submission);
  const submissionDate = resolveSubmissionDate(submission);
  const answers = submission?.answers ?? {};
  const inventoryActivities: NormalizedInventoryActivity[] = [];

  for (const [fieldId, itemCode] of Object.entries(config.itemCodeByFieldId)) {
    const rawValue = answers[fieldId];
    let quantity: number | null = null;

    try {
      quantity = parseQuantity(rawValue);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid quantity value.';
      throw new Error(`Invalid quantity for field ${fieldId}: ${message}`);
    }

    if (quantity === null) {
      continue;
    }

    const normalizedItemCode = String(itemCode).trim();
    if (!normalizedItemCode) {
      continue;
    }

    inventoryActivities.push({
      itemCode: normalizedItemCode,
      quantity: Math.trunc(quantity),
      direction: InventoryDirection.IN,
    });
  }

  const normalizedFormId = normalizeFormId(formId);

  return {
    submission: {
      jotformFormId: normalizedFormId,
      jotformSubmissionId: submissionId,
      location: config.location,
      sourceType: SourceType.INVENTORY,
      submissionDate,
    },
    inventoryActivities,
  };
}

export const sampleInventorySubmissionLowcountry: JotformSubmissionLike = {
  id: '6694626226213289541',
  created_at: '2026-11-02 16:03:42',
  updated_at: null,
  answers: {
    '8': { answer: '12' },
    '49': { answer: '7' },
    '50': { answer: '3' },
    '51': { answer: '5' },
    '52': { answer: '2' },
    '53': { answer: '4' },
    '54': { answer: '1' },
    '61': { answer: '2' },
    '62': { answer: '4' },
    '63': { answer: '1' },
    '64': { answer: '8' },
    '65': { answer: '6' },
    '70': { answer: '9' },
    '79': { answer: '5' },
    '82': { answer: '2' },
    '85': { answer: '7' },
    '88': { answer: '3' },
    '91': { answer: '2' },
    '94': { answer: '6' },
    '97': { answer: '4' },
    '106': { answer: '3' },
    '109': { answer: '2' },
    '112': { answer: '8' },
    '115': { answer: '5' },
    '118': { answer: '1' },
    '121': { answer: '2' },
    '124': { answer: '10' },
    '127': { answer: '7' },
    '136': { answer: '4' },
    '139': { answer: '3' },
    '142': { answer: '9' },
    '145': { answer: '2' },
    '148': { answer: '5' },
    '151': { answer: '3' },
  },
};

export const sampleInventorySubmissionMidlands: JotformSubmissionLike = {
  id: '6694610704027299016',
  created_at: '2026-11-02 15:37:51',
  updated_at: null,
  answers: {
    '8': { answer: '51' },
    '52': { answer: '16' },
    '62': { answer: '9' },
    '79': { answer: '3' },
    '94': { answer: '38' },
    '106': { answer: '13' },
    '121': { answer: '3' },
    '124': { answer: '51' },
    '136': { answer: '3' },
    '139': { answer: '10' },
  },
};

export function runInventoryNormalizationExamples() {
  const lowcountry = normalizeInventorySubmission(
    '241895593214161',
    sampleInventorySubmissionLowcountry,
  );

  const midlands = normalizeInventorySubmission(
    '250054265404145',
    sampleInventorySubmissionMidlands,
  );

  const invalidForm = () =>
    normalizeInventorySubmission('999999999999999', sampleInventorySubmissionLowcountry);

  const weirdValues = normalizeInventorySubmission('241895593214161', {
    id: 'bad-data-1',
    created_at: '2026-11-04T12:00:00.000Z',
    answers: {
      '8': { answer: '0' },
      '49': { answer: '-1' },
      '50': { answer: 'abc' },
      '51': { answer: '3' },
      '52': { answer: '2.5' },
      '53': { answer: '4' },
    },
  });

  return {
    lowcountry,
    midlands,
    invalidForm,
    weirdValues,
  };
}

export function testInventoryNormalization() {
  const lowcountry = normalizeInventorySubmission(
    '241895593214161',
    sampleInventorySubmissionLowcountry,
  );

  const midlands = normalizeInventorySubmission(
    '250054265404145',
    sampleInventorySubmissionMidlands,
  );

  const zeroAndNegative = normalizeInventorySubmission('241895593214161', {
    id: 'submission-invalid-values',
    created_at: '2026-11-04T15:00:00.000Z',
    answers: {
      '8': { answer: '0' },
      '49': { answer: '-4' },
      '50': { answer: 'abc' },
      '51': { answer: '2' },
      '52': { answer: '1.9' },
      '53': { answer: '4' },
    },
  });

  const invalidFormCall = () =>
    normalizeInventorySubmission('not-configured', sampleInventorySubmissionLowcountry);

  return {
    lowcountry,
    midlands,
    zeroAndNegative,
    invalidFormCall,
  };
}