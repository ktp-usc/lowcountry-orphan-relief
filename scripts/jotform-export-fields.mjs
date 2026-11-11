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

function toCsvLine(row) {
  return row.map((value) => {
    const text = value == null ? '' : String(value);
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(',');
}

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

function writeCsv(filePath, rows) {
  const header = ['field_id', 'field_name', 'field_type', 'required'];
  const csvRows = [header, ...rows.map((row) => [row.fieldId, row.name, row.type, row.required])];

  const csvText = csvRows.map(toCsvLine).join('\n') + '\n';
  fs.writeFileSync(filePath, csvText, 'utf8');
  return csvText;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let formId = args.find((arg) => /^\d+$/.test(arg));
  let outputPath = args.find((arg) => arg.startsWith('--output='));

  if (!formId) {
    throw new Error('Usage: node scripts/jotform-export-fields.mjs <FORM_ID> --output=field-export.csv');
  }

  if (outputPath) {
    outputPath = outputPath.replace('--output=', '');
  } else {
    outputPath = path.resolve(__dirname, '../exports/jotform-fields.csv');
  }

  return { formId, outputPath };
}

async function main() {
  ensureApiKey();

  const { formId, outputPath } = parseArgs();

  const forms = await fetchForms();
  const form = forms.find((item) => String(item.id) === String(formId));

  if (!form) {
    throw new Error(`Form ID ${formId} was not found in this Jotform account.`);
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