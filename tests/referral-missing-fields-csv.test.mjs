import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { test } from "node:test";

import { loadJotform } from "../scripts/lib/load-jotform.mjs";

const REFERRAL_FORM_IDS = ["261498369429070", "261526295444158"];
const OUTPUT_PATH = new URL("../.seed-build/referral-missing-field-ids.csv", import.meta.url);

// Field IDs currently consumed by normalize-referral.ts.
const MAPPED_FIELD_IDS = new Set([
  "17", "158",
  "88", "90", "93",
  "103", "104", "105",
  "110", "111", "112",
  "117", "119",
  "126", "127", "128",
  "133", "134", "135",
  "140", "141", "142",
  "147", "81", "85", "159", "83", "169", "171", "178",
]);

const KEYWORD_REGEX = /(book|books|stuffed|animal|toy|school|supply|supplies|uniform)/i;

function loadProjectEnv() {
  const repoRoot = filePathFromUrl(new URL("../", import.meta.url));
  for (const envName of [".env.local", ".env"]) {
    try {
      loadEnvFile(path.join(repoRoot, envName));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function filePathFromUrl(url) {
  return url.pathname.startsWith("/") && /^[A-Za-z]:/.test(url.pathname.slice(1))
    ? url.pathname.slice(1)
    : url.pathname;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAnswer(answer) {
  if (answer === null || answer === undefined) return "";
  if (typeof answer === "string" || typeof answer === "number" || typeof answer === "boolean") return String(answer);
  return JSON.stringify(answer);
}

function isSelected(answer) {
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === "string") {
    const value = answer.trim().toLowerCase();
    return value !== "" && value !== "no" && value !== "none" && value !== "n/a";
  }
  if (typeof answer === "number") return answer !== 0;
  if (typeof answer === "boolean") return answer;
  return answer !== null && answer !== undefined;
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

test("export unmapped referral fields and submission IDs to csv", async () => {
  loadProjectEnv();
  assert.ok(process.env.JOTFORM_API_KEY, "Set JOTFORM_API_KEY in .env or .env.local to run this test.");

  const { fetchSubmissions } = await loadJotform();
  const rows = [];

  for (const formId of REFERRAL_FORM_IDS) {
    const submissions = await fetchSubmissions(formId, { pageSize: 1000, timeoutMs: 30_000 });
    for (const submission of submissions) {
      const answers = isRecord(submission.answers) ? submission.answers : {};
      for (const [fieldId, raw] of Object.entries(answers)) {
        if (MAPPED_FIELD_IDS.has(String(fieldId))) continue;

        const field = isRecord(raw) ? raw : { answer: raw };
        const answer = field.answer ?? field.text ?? null;
        if (!isSelected(answer)) continue;

        const fieldName = String(field.name ?? "");
        const fieldText = String(field.text ?? "");
        const answerText = normalizeAnswer(answer);
        const keywordHit = KEYWORD_REGEX.test(`${fieldName} ${fieldText} ${answerText}`) ? "yes" : "no";

        rows.push({
          formId,
          submissionId: String(submission.id ?? ""),
          createdAt: String(submission.created_at ?? ""),
          fieldId: String(fieldId),
          fieldName,
          fieldText,
          answer: answerText,
          keywordHit,
        });
      }
    }
  }

  rows.sort((a, b) => {
    if (a.keywordHit !== b.keywordHit) return a.keywordHit === "yes" ? -1 : 1;
    return `${a.formId}:${a.fieldId}:${a.submissionId}`.localeCompare(`${b.formId}:${b.fieldId}:${b.submissionId}`);
  });

  const outFilePath = filePathFromUrl(OUTPUT_PATH);
  fs.mkdirSync(path.dirname(outFilePath), { recursive: true });

  const header = "formId,submissionId,createdAt,fieldId,fieldName,fieldText,answer,keywordHit";
  const body = rows.map((row) => [
    row.formId,
    row.submissionId,
    row.createdAt,
    row.fieldId,
    row.fieldName,
    row.fieldText,
    row.answer,
    row.keywordHit,
  ].map(csv).join(","));

  fs.writeFileSync(outFilePath, [header, ...body].join("\n"), "utf8");

  const keywordRows = rows.filter((row) => row.keywordHit === "yes");
  const uniqueFieldKeys = new Set(rows.map((row) => `${row.formId}:${row.fieldId}`));

  console.log(`CSV saved: ${outFilePath}`);
  console.log(`Rows written: ${rows.length}`);
  console.log(`Unique unmapped field IDs: ${uniqueFieldKeys.size}`);
  console.log(`Keyword rows: ${keywordRows.length}`);

  assert.ok(fs.existsSync(outFilePath), "CSV file was not created.");
});

