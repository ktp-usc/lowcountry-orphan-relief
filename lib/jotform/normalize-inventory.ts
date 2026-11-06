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
  // Replace these sample IDs with the real Jotform inventory form IDs once they are confirmed.
  '240656204390048': {
    location: Location.LOWCOUNTRY,
    itemCodeByFieldId: {
      '10': 'LOR-001',
      '11': 'LOR-002',
      '12': 'LOR-003',
      '13': 'LOR-004',
      '14': 'LOR-005',
    },
  },
  '241895593214161': {
    location: Location.LOWCOUNTRY,
    itemCodeByFieldId: {
      '20': 'LOR-001',
      '21': 'LOR-002',
      '22': 'LOR-003',
      '23': 'LOR-004',
      '24': 'LOR-005',
    },
  },
  '250054265404145': {
    location: Location.MIDLANDS,
    itemCodeByFieldId: {
      '30': 'MOR-001',
      '31': 'MOR-002',
      '32': 'MOR-003',
      '33': 'MOR-004',
      '34': 'MOR-005',
    },
  },
  '242465585483164': {
    location: Location.MIDLANDS,
    itemCodeByFieldId: {
      '40': 'MOR-001',
      '41': 'MOR-002',
      '42': 'MOR-003',
      '43': 'MOR-004',
      '44': 'MOR-005',
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

function toDate(value?: string | Date | null): Date {
  if (!value) {
    return new Date();
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return new Date();
}

function normalizeNestedAnswer(value: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(value, 'answer')) {
    return value.answer ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'value')) {
    return value.value ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'name')) {
    return typeof value.name === 'string' ? value.name : null;
  }

  return null;
}

function extractAnswerValue(value: JotformAnswerValue): string | number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    const nested = normalizeNestedAnswer(value as Record<string, unknown>);
    if (nested === null || nested === undefined || nested === '') {
      return null;
    }

    if (typeof nested === 'boolean') {
      return null;
    }

    return typeof nested === 'number' || typeof nested === 'string'
      ? nested
      : String(nested);
  }

  if (typeof value === 'boolean') {
    return null;
  }

  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function parseQuantity(value: JotformAnswerValue): number | null {
  const extracted = extractAnswerValue(value);
  if (extracted === null) {
    return null;
  }

  const numeric = typeof extracted === 'number' ? extracted : Number(String(extracted).trim());

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const truncated = Math.trunc(numeric);
  if (!Number.isInteger(numeric) || truncated <= 0 || truncated !== numeric) {
    return null;
  }

  return truncated;
}

/**
 * Normalize a Jotform inventory submission into Prisma-ready submission metadata and activity rows.
 */
export function normalizeInventorySubmission(
  formId: string | number,
  submission: JotformSubmissionLike,
): NormalizedInventoryResult {
  const config = getInventoryFormConfig(formId);
  const answers = submission?.answers ?? {};
  const inventoryActivities: NormalizedInventoryActivity[] = [];

  for (const [fieldId, itemCode] of Object.entries(config.itemCodeByFieldId)) {
    const rawValue = answers[fieldId];
    const quantity = parseQuantity(rawValue);

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
  const submissionId = submission?.id ?? '';
  const submissionDate = toDate(
    submission?.created_at ?? submission?.updated_at ?? submission?.createdAt ?? submission?.updatedAt,
  );

  return {
    submission: {
      jotformFormId: normalizedFormId,
      jotformSubmissionId: String(submissionId ?? '').trim() || 'unknown-submission-id',
      location: config.location,
      sourceType: SourceType.INVENTORY,
      submissionDate,
    },
    inventoryActivities,
  };
}

export const sampleInventorySubmissionLowcountry: JotformSubmissionLike = {
  id: '5905733186785103812',
  createdAt: '2026-11-04T10:00:00.000Z',
  answers: {
    '10': { answer: '5' },
    '11': { answer: '2' },
    '12': { answer: '0' },
    '13': { answer: '7' },
    '14': { answer: '3' },
    '99': { answer: 'ignored-field' },
  },
};

export const sampleInventorySubmissionMidlands: JotformSubmissionLike = {
  id: '6614314872311431504',
  createdAt: '2026-11-04T11:15:00.000Z',
  answers: {
    '30': { answer: '8' },
    '31': { answer: '-2' },
    '32': { answer: '' },
    '33': { answer: '4' },
    '34': { answer: '0' },
    '50': { answer: '10' },
  },
};

/**
 * Run a small set of normalization examples covering valid and invalid inventory data.
 */
export function runInventoryNormalizationExamples() {
  const lowcountry = normalizeInventorySubmission(
    '240656204390048',
    sampleInventorySubmissionLowcountry,
  );

  const midlands = normalizeInventorySubmission(
    '250054265404145',
    sampleInventorySubmissionMidlands,
  );

  const invalidForm = () =>
    normalizeInventorySubmission('999999999999999', sampleInventorySubmissionLowcountry);

  const weirdValues = normalizeInventorySubmission('240656204390048', {
    id: 'bad-data-1',
    createdAt: '2026-11-04T12:00:00.000Z',
    answers: {
      '10': { answer: '0' },
      '11': { answer: '-1' },
      '12': { answer: 'abc' },
      '13': { answer: '4' },
      '14': { answer: '2.5' },
    },
  });

  return {
    lowcountry,
    midlands,
    invalidForm,
    weirdValues,
  };
}

/**
 * Exercise the inventory normalizer against valid, invalid, zero, and negative inputs.
 */
export function testInventoryNormalization() {
  const lowcountry = normalizeInventorySubmission(
    '240656204390048',
    sampleInventorySubmissionLowcountry,
  );

  const midlands = normalizeInventorySubmission(
    '250054265404145',
    sampleInventorySubmissionMidlands,
  );

  const zeroAndNegative = normalizeInventorySubmission('240656204390048', {
    id: 'submission-invalid-values',
    createdAt: '2026-11-04T15:00:00.000Z',
    answers: {
      '10': { answer: '0' },
      '11': { answer: '-4' },
      '12': { answer: 'abc' },
      '13': { answer: '2' },
      '14': { answer: '1.9' },
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
