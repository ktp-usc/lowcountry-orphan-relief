#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');
const REMOVED_FIELD_IDS = new Set([
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
]);

const EXCLUDED_FORM_IDS = new Set([
  '261534987726067', // Funds Request Form
]);

/**
 * Load environment variables from the .env file.
 */
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

/**
 * Ensure the JOTFORM_API_KEY is set in the environment.
 */
function ensureApiKey() {
  loadEnvFile();

  if (!process.env.JOTFORM_API_KEY) {
    throw new Error('JOTFORM_API_KEY is missing. Add it to .env before running the script.');
  }
}

/**
 * Make a request to the Jotform API.
 */
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

/**
 * Fetch all forms for the authenticated user.
 */
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

  return forms;
}

/**
 * Fetch the questions (fields) for a specific form.
 */
async function fetchFormQuestions(formId) {
  const response = await jotformRequest(`/form/${formId}/questions`);
  return response?.content ?? {};
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

/**
 * Neutralize spreadsheet-formula triggers before writing CSV values.
 */
function toCsvLine(row) {
  return row.map((value) => {
    const text = value == null ? '' : String(value);
    const normalized = text.replace(/^([=+\-@\t\r])/u, "'$1");
    const escaped = normalized.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(',');
}

/**
 * Build rows for CSV output from the form questions.
 */
function buildFieldRows(questionMap) {
  const rows = [];

  for (const [fieldId, field] of Object.entries(questionMap)) {
    if (REMOVED_FIELD_IDS.has(String(fieldId))) {
      continue;
    }

    const name = normalizeText(field?.text ?? field?.name ?? fieldId);
    const type = normalizeText(field?.type ?? 'unknown');
    const required = field?.required === 'Yes' ? 'yes' : 'no';
    rows.push({
      fieldId,
      name,
      type,
      required,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  return rows;
}

/**
 * Write the CSV file to the specified path.
 */
function writeCsv(filePath, rows) {
  const header = ['field_id', 'field_name', 'field_type', 'required'];
  const csvRows = [header, ...rows.map((row) => [row.fieldId, row.name, row.type, row.required])];

  const csvText = csvRows.map(toCsvLine).join('\n') + '\n';
  fs.writeFileSync(filePath, csvText, 'utf8');
  return csvText;
}

/**
 * Parse the script arguments and validate the export path.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let formId = null;
  let outputPath = null;
  let seenOutput = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--output' || arg === '-o') {
      const nextValue = args[i + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('Missing output path after --output.');
      }
      outputPath = nextValue;
      seenOutput = true;
      i += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
      seenOutput = true;
      continue;
    }

    if (/^\d+$/.test(arg)) {
      if (!formId) {
        formId = arg;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!formId) {
    throw new Error('Usage: node scripts/jotform-export-fields.mjs <FORM_ID> [--output <PATH> | --output=<PATH>]');
  }

  if (outputPath === null || outputPath.trim() === '') {
    if (seenOutput) {
      throw new Error('Missing output path after --output.');
    }
    outputPath = path.resolve(__dirname, '../exports/jotform-fields.csv');
  }

  return { formId, outputPath };
}

/**
 * Whether a form is explicitly excluded from export review lists.
 */
function shouldSkipForm(form) {
  return form && EXCLUDED_FORM_IDS.has(String(form.id));
}

async function main() {
  ensureApiKey();

  const { formId, outputPath } = parseArgs();

  const forms = await fetchForms();
  const form = forms.find((item) => String(item.id) === String(formId));

  if (!form) {
    throw new Error(`Form ID ${formId} was not found in this Jotform account.`);
  }

  if (shouldSkipForm(form)) {
    throw new Error(`Form ${form.id} is excluded from export by policy.`);
  }

  const questions = await fetchFormQuestions(formId);
  const rows = buildFieldRows(questions);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  writeCsv(outputPath, rows);

  console.log(`
Exported field list for form: ${form.title} (${form.id})`);
  console.log(`CSV file: ${outputPath}`);
  console.log('Columns: field_id, field_name, field_type, required');
  console.log('\nPreview:');

  for (const row of rows.slice(0, 20)) {
    console.log(`${row.fieldId} | ${row.type} | ${row.name}`);
  }

  if (rows.length > 20) {
    console.log(`... and ${rows.length - 20} more fields`);
  }
}

main().catch((error) => {
  console.error('\nField export failed.');
  console.error(error.message);
  process.exit(1);
});