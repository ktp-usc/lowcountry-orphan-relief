#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');

const TARGET_FORM_IDS = {
  inventory: [
    // TODO: add the exact numeric Jotform IDs for the inventory forms from the client meeting notes / Google Doc.
    // Example: 1234567890, 1234567891
  ],
  referral: [
    // TODO: add the exact numeric Jotform IDs for the referral forms from the client meeting notes / Google Doc.
    // Example: 0987654321, 0987654322
  ],
};

const SAFE_FIELD_IDS = {
  inventory: new Set([
    // TODO: add the exact field IDs that are approved for inventory reporting.
    // This should include operational values like item names, quantities, counts, measurements, and other non-personal data.
    // Keep out names, addresses, locations, ages, and any personal identifiers.
    // Example: '10', '12', '22', '48'
  ]),
  referral: new Set([
    // TODO: add the exact field IDs that are approved for referral reporting.
    // This should be limited to non-sensitive business fields only.
    // Example: '3', '8', '17', '28'
  ]),
};

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

  url.searchParams.set('apiKey', process.env.JOTFORM_API_KEY);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
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
  const inventoryIds = new Set(normalizeNumericIdList(TARGET_FORM_IDS.inventory));
  const referralIds = new Set(normalizeNumericIdList(TARGET_FORM_IDS.referral));

  if (!inventoryIds.size && !referralIds.size) {
    return [];
  }

  return forms.filter((form) => {
    const numericId = Number(form.id);
    return inventoryIds.has(numericId) || referralIds.has(numericId);
  });
}

function getAllowlistForForm(form) {
  const id = Number(form.id);

  if (TARGET_FORM_IDS.inventory.includes(id)) {
    return SAFE_FIELD_IDS.inventory;
  }

  if (TARGET_FORM_IDS.referral.includes(id)) {
    return SAFE_FIELD_IDS.referral;
  }

  return null;
}

async function fetchForms() {
  const response = await jotformRequest('/user/forms');
  return sortFormsByName(Array.isArray(response?.content) ? response.content : []);
}

async function fetchFormQuestions(formId) {
  const response = await jotformRequest(`/form/${formId}/questions`);
  return response?.content ?? {};
}

async function fetchRecentSubmissions(formId, limit = 3) {
  const response = await jotformRequest(`/form/${formId}/submissions`, { limit });
  return Array.isArray(response?.content) ? response.content : [];
}

function renderQuestionTable(questions) {
  const rows = Object.entries(questions)
    .map(([fieldId, field]) => ({
      fieldId,
      name: normalizeText(field?.text ?? field?.name ?? fieldId),
      type: normalizeText(field?.type ?? 'unknown'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!rows.length) {
    console.log('No field metadata returned.');
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

function getAllowedSubmissionEntries(submission, allowlist) {
  const answers = submission?.answers ?? {};

  return Object.entries(answers)
    .filter(([fieldId]) => allowlist.has(String(fieldId)))
    .map(([fieldId, value]) => {
      const fieldName = normalizeText(value?.name ?? fieldId);
      const answerValue = formatAnswerValue(value?.answer ?? value?.text ?? value);
      return { fieldId, fieldName, answerValue };
    });
}

function printSampleSubmission(form, submission, allowlist) {
  const lines = [];
  const entries = getAllowedSubmissionEntries(submission, allowlist);

  lines.push(`Submission ID: ${submission?.id ?? 'unknown'}`);

  if (!entries.length) {
    lines.push('No approved fields found for this submission.');
  } else {
    for (const item of entries) {
      lines.push(`- ${item.fieldId} | ${item.fieldName}: ${item.answerValue}`);
    }
  }

  console.log(`\n${form.title} sample submission:`);
  for (const line of lines) {
    console.log(line);
  }
}

function buildPasteableText(forms) {
  const lines = [];

  for (const form of forms) {
    const allowlist = getAllowlistForForm(form);
    lines.push(`FORM: ${form.title} (${form.id})`);
    lines.push('Field list:');

    const questions = form.questions ?? {};
    const rows = Object.entries(questions)
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

    if (allowlist) {
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

  if (!targetForms.length) {
    console.log('No target form IDs are configured yet.');
    console.log('Update TARGET_FORM_IDS in this script with the exact numeric form IDs from the client notes document.');
    console.log('Do not rely on title matching.');
    return;
  }

  printHeading('Target forms');
  for (const form of targetForms) {
    console.log(`${form.title} | ${form.id}`);
  }

  const formDetails = [];

  for (const form of targetForms) {
    const questions = await fetchFormQuestions(form.id);
    form.questions = questions;

    printHeading(`Fields for ${form.title} (${form.id})`);
    renderQuestionTable(questions);

    const submissions = await fetchRecentSubmissions(form.id, 3);
    const allowlist = getAllowlistForForm(form);

    printHeading(`Sample submissions for ${form.title} (${form.id})`);

    if (!allowlist || !allowlist.size) {
      console.log('No approved field IDs are configured for this form. Add the exact IDs before sharing output.');
      continue;
    }

    if (!submissions.length) {
      console.log('No submissions returned.');
      continue;
    }

    for (const submission of submissions) {
      printSampleSubmission(form, submission, allowlist);
    }

    formDetails.push(form);
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

  console.log('\nNext steps:');
  console.log('1. Copy the exact field IDs from the output above into SAFE_FIELD_IDS for each target form.');
  console.log('2. Keep all submission output limited to those approved IDs only.');
  console.log('3. Exclude names, locations, ages, and other personal data before pasting anything into the shared Google Doc.');
  console.log('4. If you want a text file for copy/paste, rerun with: node scripts/jotform-inspect.mjs --output jotform-output.txt');
}

main().catch((error) => {
  console.error('\nJotform inspection failed.');
  console.error(error.message);
  process.exit(1);
});