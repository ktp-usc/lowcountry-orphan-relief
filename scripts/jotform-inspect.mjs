#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');

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

function isSensitiveKey(key) {
  const lowered = key.toLowerCase();
  const patterns = [
    'first', 'last', 'full', 'middle', 'name',
    'email', 'phone', 'mobile', 'cell', 'address', 'street',
    'city', 'state', 'zip', 'postal', 'country',
    'dob', 'birth', 'gender', 'race', 'ethnicity',
    'ssn', 'social', 'driver', 'license', 'passport',
    'signature', 'ip', 'profile', 'contact', 'emergency',
    'guardian', 'parent', 'family', 'notes', 'comments', 'message'
  ];

  return patterns.some((pattern) => lowered.includes(pattern));
}

function printRelevantSubmissionSummary(formLabel, submission) {
  const answers = submission?.answers ?? {};
  const filteredEntries = Object.entries(answers)
    .filter(([key, value]) => {
      const label = value?.text ?? value?.answer ?? '';
      const fieldName = normalizeText(value?.name ?? key);
      const fieldId = normalizeText(key);
      const isSensitive = isSensitiveKey(fieldName) || isSensitiveKey(fieldId) || isSensitiveKey(String(label));
      return !isSensitive && label !== '';
    })
    .map(([key, value]) => {
      const fieldName = normalizeText(value?.name ?? key);
      const answerValue = value?.answer ?? value?.text ?? value;
      return { key, fieldName, answerValue };
    });

  console.log(`\nRecent ${formLabel} submission (relevant fields only):`);

  if (!filteredEntries.length) {
    console.log('No relevant fields found after filtering sensitive data.');
    return;
  }

  for (const item of filteredEntries) {
    console.log(`- ${item.fieldName || item.key}: ${JSON.stringify(item.answerValue)}`);
  }
}

function sortFormsByName(forms) {
  return [...forms].sort((a, b) => a.title.localeCompare(b.title));
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

function printQuestionsForForm(form) {
  console.log(`\nForm: ${form.title} (${form.id})`);
  console.log('Field summary:');
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

function printSubmissionSummary(submission, label) {
  const answers = submission?.answers ?? {};
  const printable = Object.entries(answers).map(([key, value]) => {
    const answerValue = value?.answer ?? value?.text ?? value;
    const fieldName = value?.name ?? key;
    return { key, fieldName, answerValue };
  });

  console.log(`\n${label} recent submission:`);
  if (!printable.length) {
    console.log('No answers returned.');
    return;
  }

  for (const item of printable) {
    console.log(`- ${item.fieldName || item.key}: ${JSON.stringify(item.answerValue)}`);
  }
}

async function main() {
  ensureApiKey();

  console.log('Connecting to Jotform API...');

  const forms = await fetchForms();

  printHeading('All available forms');
  if (!forms.length) {
    console.log('No forms found for this Jotform account.');
    return;
  }

  for (const form of forms) {
    console.log(`${form.title} | ${form.id}`);
  }

  const inventoryForms = forms.filter((form) => /inventory/i.test(form.title));
  const referralForms = forms.filter((form) => /referral/i.test(form.title));

  printHeading('Likely inventory forms');
  for (const form of inventoryForms) {
    console.log(`${form.title} | ${form.id}`);
  }

  printHeading('Likely referral forms');
  for (const form of referralForms) {
    console.log(`${form.title} | ${form.id}`);
  }

  if (!inventoryForms.length && !referralForms.length) {
    console.log('No forms with "inventory" or "referral" in the title were found. Check the output above for the exact form names and IDs.');
    return;
  }

  for (const form of inventoryForms) {
    const questions = await fetchFormQuestions(form.id);
    printHeading(`Inventory fields: ${form.title}`);
    renderQuestionTable(questions);

    const submissions = await fetchRecentSubmissions(form.id, 3);
    printHeading(`Inventory recent submissions: ${form.title}`);
    if (!submissions.length) {
      console.log('No submissions returned.');
      continue;
    }

    for (const submission of submissions) {
      printSubmissionSummary(submission, form.title);
    }
  }

  for (const form of referralForms) {
    const questions = await fetchFormQuestions(form.id);
    printHeading(`Referral fields: ${form.title}`);
    renderQuestionTable(questions);

    const submissions = await fetchRecentSubmissions(form.id, 1);
    if (!submissions.length) {
      console.log('No submissions returned.');
      continue;
    }

    const recentSubmission = submissions[0];
    printRelevantSubmissionSummary('referral', recentSubmission);
  }

  console.log('\nNext steps:');
  console.log('1. Confirm the exact four relevant form IDs from the output above.');
  console.log('2. Compare the recent inventory payloads with the inventory Google Sheet rows and verify the matching values.');
  console.log('3. Update the shared Google doc with the final field IDs, names, and data types for both forms.');
}

main().catch((error) => {
  console.error('\nJotform inspection failed.');
  console.error(error.message);
  process.exit(1);
});

