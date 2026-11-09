#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');

const TARGET_FORM_IDS = {
  inventory: [
    '241895593214161', // LOR Quantity Form (inventory)
    '250054265404145', // MOR Quantity Form (inventory)
  ],
  referral: [
    '261498369429070', // LOR Referral form
    '261526295444158', // MOR Referral form
  ],
};

const SAFE_FIELD_IDS = {
  inventory: new Set([
    // Keep this empty for the review phase.
    // The script currently defaults to showing all fields except the known removed sensitive IDs.
  ]),
  referral: new Set([
    // Keep this empty for the review phase.
    // The script currently defaults to showing all fields except the known removed sensitive IDs.
  ]),
};

const EXCLUDED_FORM_IDS = new Set([
  '261534987726067', // Funds Request Form
]);

const DEFAULT_REMOVED_FIELD_IDS = new Set([
  '9',
  '181',
  '15',
  '182',
  '175',
  '17',
  '158',
  '6',
  '176',
  '7',
  '47',
  '179',
  '174',
  '10',
  '14',
  '16',
  '18',
  '48',
  '54','12', '8',
]);

// Add additional sensitive field IDs for a specific Jotform form here.
// The key should be the exact Jotform form id as a string.
const FORM_SPECIFIC_REMOVED_FIELD_IDS = {
  // Example:
  // '241893620632154': new Set(['10', '14', '16', '18', '48', '54']),
};

function shouldSkipForm(form) {
  return form && EXCLUDED_FORM_IDS.has(String(form.id));
}

function getRemovedFieldIdsForForm(formId) {
  const normalizedFormId = String(formId ?? '');
  const combined = new Set(DEFAULT_REMOVED_FIELD_IDS);

  const formSpecific = FORM_SPECIFIC_REMOVED_FIELD_IDS[normalizedFormId];
  if (formSpecific) {
    for (const fieldId of formSpecific) {
      combined.add(String(fieldId));
    }
  }

  return combined;
}

function shouldSkipField(formId, fieldId) {
  if (shouldSkipForm({ id: formId })) {
    return true;
  }

  return getRemovedFieldIdsForForm(formId).has(String(fieldId));
}

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  let outputPath = null;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--output' || arg === '-o') {
      outputPath = rawArgs[i + 1] ?? null;
      i += 1;
    }
  }

  return { outputPath };
}

function loadEnvFile() {
  if (process.env.JOTFORM_API_KEY) {
    return;
  }

  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`Missing .env file at ${ENV_PATH}. Add JOTFORM_API_KEY to it before running this script.`);
  }

  const fileContents = fs.readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    const cleanedValue = value.replace(/^['"]|['"]$/g, '').trim();

    if (!process.env[key]) {
      process.env[key] = cleanedValue;
    }
  }
}

function ensureApiKey() {
  loadEnvFile();

  if (!process.env.JOTFORM_API_KEY) {
    throw new Error('JOTFORM_API_KEY is missing. Add it to .env before running the script.');
  }
}

async function jotformRequest(endpoint, params = {}) {
  const url = new URL(`https://api.jotform.com${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      APIKEY: process.env.JOTFORM_API_KEY,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Jotform request failed for ${endpoint}: ${response.status} ${response.statusText} - ${text}`);
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON from Jotform API for ${endpoint}: ${error.message}`);
  }
}

function printHeading(label) {
  console.log(`\n=== ${label} ===`);
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function sortFormsByName(forms) {
  return [...forms].sort((a, b) => a.title.localeCompare(b.title));
}

function normalizeNumericIdList(values = []) {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function getTargetForms(forms) {
  const filtered = forms.filter((form) => !shouldSkipForm(form));
  const configuredIds = new Set(
    [...TARGET_FORM_IDS.inventory, ...TARGET_FORM_IDS.referral].map((value) => String(value)),
  );

  if (configuredIds.size > 0) {
    return filtered.filter((form) => configuredIds.has(String(form.id)));
  }

  return filtered;
}

function getAllowlistForForm(form) {
  if (!form || !form.id) {
    return null;
  }

  const inventoryIsEmpty = SAFE_FIELD_IDS.inventory.size === 0;
  const referralIsEmpty = SAFE_FIELD_IDS.referral.size === 0;
  if (inventoryIsEmpty && referralIsEmpty) {
    return null;
  }

  const id = String(form.id);
  if (TARGET_FORM_IDS.inventory.includes(id)) {
    return SAFE_FIELD_IDS.inventory;
  }

  if (TARGET_FORM_IDS.referral.includes(id)) {
    return SAFE_FIELD_IDS.referral;
  }

  return null;
}

async function fetchForms() {
  const limit = 100;
  const forms = [];
  let offset = 0;

  while (true) {
    const response = await jotformRequest('/user/forms', { limit, offset });
    const page = Array.isArray(response?.content) ? response.content : [];
    forms.push(...page);

    const resultSet = response?.resultSet;
    const pageLimit = Number(resultSet?.limit);
    const pageCount = Number(resultSet?.count);
    const effectiveLimit = Number.isFinite(pageLimit) && pageLimit > 0 ? pageLimit : limit;
    const receivedCount = Number.isFinite(pageCount) ? pageCount : page.length;
    if (receivedCount < effectiveLimit) {
      break;
    }

    const pageOffset = Number(resultSet?.offset);
    offset = (Number.isFinite(pageOffset) ? pageOffset : offset) + receivedCount;
  }

  return sortFormsByName(forms);
}

async function fetchFormQuestions(formId) {
  const response = await jotformRequest(`/form/${formId}/questions`);
  return response?.content ?? {};
}

async function fetchRecentSubmissions(formId, limit = 3) {
  const response = await jotformRequest(`/form/${formId}/submissions`, { limit });
  return Array.isArray(response?.content) ? response.content : [];
}

function renderQuestionTable(form, questions) {
  const rows = Object.entries(questions)
    .filter(([fieldId]) => !shouldSkipField(form.id, fieldId))
    .map(([fieldId, field]) => ({
      fieldId,
      name: normalizeText(field?.text ?? field?.name ?? fieldId),
      type: normalizeText(field?.type ?? 'unknown'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!rows.length) {
    console.log('No field metadata returned after removing excluded IDs.');
    return;
  }

  console.log('ID | Type | Name');
  for (const row of rows) {
    console.log(`${row.fieldId} | ${row.type} | ${row.name}`);
  }
}

function formatAnswerValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    const direct = value.answer ?? value.text ?? value.value;
    if (direct !== undefined && direct !== null) {
      return String(direct);
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function getAllowedSubmissionEntries(form, submission, allowlist = null) {
  const answers = submission?.answers ?? {};

  return Object.entries(answers)
    .filter(([fieldId]) => {
      const idString = String(fieldId);
      if (shouldSkipField(form.id, idString)) {
        return false;
      }

      if (!allowlist) {
        return true;
      }

      return allowlist.has(idString);
    })
    .map(([fieldId, value]) => {
      const fieldName = normalizeText(value?.name ?? fieldId);
      const answerValue = formatAnswerValue(value?.answer ?? value?.text ?? value);
      return { fieldId, fieldName, answerValue };
    });
}

function printSampleSubmission(form, submission, allowlist) {
  const entries = getAllowedSubmissionEntries(form, submission, allowlist);

  if (!entries.length) {
    return;
  }

  console.log(`\n${form.title} sample submission:`);
  console.log(`Submission ID: ${submission?.id ?? 'unknown'}`);
  for (const item of entries) {
    console.log(`- ${item.fieldId} | ${item.fieldName}: ${item.answerValue}`);
  }
}

function buildPasteableText(forms) {
  const lines = [];

  for (const form of forms) {
    if (shouldSkipForm(form)) {
      continue;
    }

    const allowlist = getAllowlistForForm(form);
    lines.push(`FORM: ${form.title} (${form.id})`);
    lines.push('Field list:');

    const questions = form.questions ?? {};
    const rows = Object.entries(questions)
      .filter(([fieldId]) => !shouldSkipField(form.id, fieldId))
      .map(([fieldId, field]) => ({
        fieldId,
        name: normalizeText(field?.text ?? field?.name ?? fieldId),
        type: normalizeText(field?.type ?? 'unknown'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!rows.length) {
      lines.push('No field metadata returned.');
    } else {
      for (const row of rows) {
        lines.push(`${row.fieldId} | ${row.type} | ${row.name}`);
      }
    }

    lines.push('');

    if (allowlist && allowlist.size) {
      lines.push('Approved field IDs for sanitized output:');
      lines.push([...allowlist].join(', '));
    }

    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  ensureApiKey();

  const { outputPath } = parseArgs();
  console.log('Connecting to Jotform API...');

  const forms = await fetchForms();
  const targetForms = getTargetForms(forms);

  printHeading('Available forms');
  for (const form of targetForms) {
    console.log(`${form.title} | ${form.id}`);
  }

  if (!targetForms.length) {
    console.log('No forms are available in this Jotform account after excluding the funds request form.');
    return;
  }

  const formDetails = [];

  for (const form of targetForms) {
    const questions = await fetchFormQuestions(form.id);
    form.questions = questions;
    formDetails.push(form);

    printHeading(`Fields for ${form.title} (${form.id})`);
    renderQuestionTable(form, questions);

    const allowlist = getAllowlistForForm(form);

    const submissions = await fetchRecentSubmissions(form.id, 3);
    printHeading(`Sample submissions for ${form.title} (${form.id})`);

    if (!submissions.length) {
      console.log('No submissions returned.');
      continue;
    }

    const visibleSubmissions = submissions.filter((submission) => {
      return getAllowedSubmissionEntries(form, submission, allowlist).length > 0;
    });

    if (!visibleSubmissions.length) {
      console.log('No visible submissions after filtering excluded fields.');
      continue;
    }

    for (const submission of visibleSubmissions) {
      printSampleSubmission(form, submission, allowlist);
    }
  }

  if (outputPath) {
    const documentText = buildPasteableText(formDetails);
    const fullOutputPath = path.resolve(process.cwd(), outputPath);
    const targetDir = path.dirname(fullOutputPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(fullOutputPath, documentText, 'utf8');
    console.log(`\nSanitized pasteable output saved to: ${fullOutputPath}`);
  }

  console.log('\nReview mode: all fields are shown except the configured excluded IDs.');
  console.log('Excluded form IDs: ' + [...EXCLUDED_FORM_IDS].join(', '));
  console.log('Excluded field IDs: ' + [...DEFAULT_REMOVED_FIELD_IDS].join(', '));
  const formSpecificSummary = Object.entries(FORM_SPECIFIC_REMOVED_FIELD_IDS).map(([formId, fieldIds]) => `${formId}:${[...fieldIds].join(',')}`);
  console.log('Form-specific excluded field IDs: ' + (formSpecificSummary.length ? formSpecificSummary.join(' | ') : 'none'));
  console.log('This ensures the funds request form stays fully excluded while the rest of the data is reviewed by field ID.');
}

main().catch((error) => {
  console.error('\nJotform inspection failed.');
  console.error(error.message);
  process.exit(1);
});