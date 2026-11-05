import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeInventorySubmission } from '../lib/jotform/normalize-inventory';

const formId = '240656204390048';
const timestamp = '2026-11-04T10:00:00.000Z';

test('only positive whole quantities produce activities', () => {
  const result = normalizeInventorySubmission(formId, {
    createdAt: timestamp,
    answers: {
      '10': { answer: '0.5' },
      '11': { answer: '2.5' },
      '12': { answer: '3' },
      '13': { answer: '-1' },
      '14': { answer: '0' },
    },
  });

  assert.deepEqual(result.inventoryActivities, [
    { itemCode: 'LOR-003', quantity: 3, direction: 'IN' },
  ]);
});

test('accepts each supported timestamp field', () => {
  for (const field of ['createdAt', 'created_at', 'updatedAt', 'updated_at']) {
    const result = normalizeInventorySubmission(formId, { [field]: timestamp });
    assert.equal(result.submission.submissionDate.toISOString(), timestamp, field);
  }
});

test('prefers creation timestamps and falls back through null values', () => {
  const result = normalizeInventorySubmission(formId, {
    createdAt: null,
    created_at: timestamp,
    updatedAt: '2026-11-05T10:00:00.000Z',
    updated_at: '2026-11-06T10:00:00.000Z',
  });
  assert.equal(result.submission.submissionDate.toISOString(), timestamp);
});

test('rejects missing or invalid selected timestamps', () => {
  for (const submission of [
    {},
    { created_at: '' },
    { updated_at: 'not-a-date' },
    { createdAt: new Date(NaN) },
    { created_at: 'not-a-date', updated_at: timestamp },
  ]) {
    assert.throws(() => normalizeInventorySubmission(formId, submission), /valid submission timestamp/);
  }
});
