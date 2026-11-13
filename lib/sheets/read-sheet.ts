import { createTokenProvider } from "./auth.js";
import { isRecord, requestJson, SheetReadError } from "./errors.js";
import { SHEET_MAPPINGS } from "./mappings.js";
import { REFERRAL_CANCELLATION_YELLOW } from "./sources.js";
import type { SheetSource, SheetRow, ReadSheetOptions, ReadSheetResult } from "./types.js";

const pageSize = 500;
const fields = "spreadsheetId,properties(spreadsheetTheme(themeColors)),sheets(properties(sheetId,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat(backgroundColorStyle,backgroundColor)))))";
type Cell = Record<string, unknown>;
type Grid = { rows: Map<number, Map<number, Cell>>; rowCount: number; columnCount: number; theme: Map<string, unknown> };
type ReaderDependencies = {
  request: typeof fetch;
  getAccessToken: (json: string) => Promise<string>;
  cancellationYellow: string | null;
};

function validate(source: SheetSource, options: ReadSheetOptions, yellow: string | null) {
  if (typeof window !== "undefined") throw new SheetReadError("readSheet must run on the server.");
  if (!isRecord(source) || typeof source.key !== "string" || !/^[a-zA-Z0-9_-]+$/.test(source.key)
    || typeof source.spreadsheetId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(source.spreadsheetId)
    || typeof source.jotformFormId !== "string" || !/^\d+$/.test(source.jotformFormId)
    || !["LOWCOUNTRY", "MIDLANDS"].includes(source.location) || !["INVENTORY", "REFERRAL"].includes(source.sourceType)) {
    throw new SheetReadError("Invalid SheetSource configuration.");
  }
  if (!Number.isSafeInteger(source.tabId) || source.tabId < 0) throw new SheetReadError("Configure the verified tabId from the Sheet tab's gid; no default tab is selected.");
  if (typeof source.submissionIdHeader !== "string" || !source.submissionIdHeader.trim()
    || typeof source.submissionDateHeader !== "string" || !source.submissionDateHeader.trim()) {
    throw new SheetReadError("Configure the verified submission ID and date headers; an unlabeled column cannot be used.");
  }
  if (source.submissionIdHeader.trim().toLowerCase() === source.submissionDateHeader.trim().toLowerCase()) {
    throw new SheetReadError("The submission ID and date must identify different columns.");
  }
  if (!isRecord(options) || (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))) {
    throw new SheetReadError("limit must be a positive safe integer.");
  }
  if (source.sourceType === "REFERRAL" && (yellow === null || !/^#[0-9a-f]{6}$/i.test(yellow))) {
    throw new SheetReadError("Verify and configure the cancellation color from a real cancelled referral's Submission ID cell.");
  }
}

function parseGrid(body: unknown, source: SheetSource, start: number, end: number): Grid {
  const invalid = () => new SheetReadError("Google Sheets returned invalid or misaligned grid data.");
  if (!isRecord(body) || body.spreadsheetId !== source.spreadsheetId || !Array.isArray(body.sheets)) throw invalid();
  const matches = body.sheets.filter((s) => isRecord(s) && isRecord(s.properties) && s.properties.sheetId === source.tabId);
  if (matches.length !== 1) throw new SheetReadError("The configured tabId was not returned exactly once; check the selected tab.");
  const sheet = matches[0] as Record<string, unknown>;
  const properties = sheet.properties as Record<string, unknown>;
  const dimensions = properties.gridProperties;
  if (!isRecord(dimensions) || typeof dimensions.rowCount !== "number" || !Number.isSafeInteger(dimensions.rowCount) || dimensions.rowCount < 1
    || typeof dimensions.columnCount !== "number" || !Number.isSafeInteger(dimensions.columnCount) || dimensions.columnCount < 1) throw invalid();
  if (sheet.data !== undefined && !Array.isArray(sheet.data)) throw invalid();
  const rows = new Map<number, Map<number, Cell>>();
  for (const block of (sheet.data ?? []) as unknown[]) {
    if (!isRecord(block) || (block.rowData !== undefined && !Array.isArray(block.rowData))) throw invalid();
    const rowStart = block.startRow ?? 0, columnStart = block.startColumn ?? 0;
    if (typeof rowStart !== "number" || !Number.isSafeInteger(rowStart) || rowStart < 0
      || typeof columnStart !== "number" || !Number.isSafeInteger(columnStart) || columnStart < 0) throw invalid();
    for (const [i, row] of ((block.rowData ?? []) as unknown[]).entries()) {
      if (!isRecord(row) || (row.values !== undefined && !Array.isArray(row.values))) throw invalid();
      const index = rowStart + i;
      if (index < start || index >= end || index >= dimensions.rowCount) throw invalid();
      const cells = rows.get(index) ?? new Map<number, Cell>();
      for (const [j, cell] of ((row.values ?? []) as unknown[]).entries()) {
        const column = columnStart + j;
        if (!isRecord(cell) || column >= dimensions.columnCount || cells.has(column)) throw invalid();
        cells.set(column, cell);
      }
      rows.set(index, cells);
    }
  }
  const theme = new Map<string, unknown>();
  if (isRecord(body.properties) && isRecord(body.properties.spreadsheetTheme) && Array.isArray(body.properties.spreadsheetTheme.themeColors)) {
    for (const color of body.properties.spreadsheetTheme.themeColors) {
      if (isRecord(color) && typeof color.colorType === "string") theme.set(color.colorType, color.color);
    }
  }
  return { rows, rowCount: dimensions.rowCount, columnCount: dimensions.columnCount, theme };
}

function cellText(cell: Cell | undefined, rowNumber: number, column: number): string {
  if (!cell) return "";
  const effective = cell.effectiveValue;
  if (isRecord(effective) && effective.errorValue !== undefined) throw new SheetReadError(`Cell error at row ${rowNumber}, column ${column + 1}.`);
  if (isRecord(effective) && typeof effective.stringValue === "string") return effective.stringValue;
  if (typeof cell.formattedValue === "string") return cell.formattedValue;
  if (isRecord(effective) && typeof effective.numberValue === "number" && Number.isFinite(effective.numberValue)) return String(effective.numberValue);
  if (isRecord(effective) && typeof effective.boolValue === "boolean") return effective.boolValue ? "TRUE" : "FALSE";
  const entered = cell.userEnteredValue;
  if (isRecord(entered) && typeof entered.stringValue === "string") return entered.stringValue;
  if (effective !== undefined && (!isRecord(effective) || Object.keys(effective).length)) throw new SheetReadError(`Unsupported cell value at row ${rowNumber}, column ${column + 1}.`);
  return "";
}

function rgbHex(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const parts = [value.red ?? 0, value.green ?? 0, value.blue ?? 0];
  if (!parts.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return undefined;
  return "#" + (parts as number[]).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

function background(cell: Cell | undefined, theme: Map<string, unknown>, rowNumber: number): string | undefined {
  if (!cell || cell.effectiveFormat === undefined) return undefined; // Default fill is not yellow.
  if (!isRecord(cell.effectiveFormat)) throw new SheetReadError(`Invalid Submission ID cell formatting at row ${rowNumber}.`);
  const format = cell.effectiveFormat;
  const style = format.backgroundColorStyle;
  if (style !== undefined) {
    if (!isRecord(style)) throw new SheetReadError(`Invalid Submission ID color at row ${rowNumber}.`);
    if (style.rgbColor !== undefined) {
      const hex = rgbHex(style.rgbColor);
      if (hex) return hex;
    } else if (typeof style.themeColor === "string") {
      const selected = theme.get(style.themeColor);
      const hex = isRecord(selected) ? rgbHex(selected.rgbColor) : undefined;
      if (hex) return hex;
    }
    throw new SheetReadError(`Cannot resolve the Submission ID background color at row ${rowNumber}.`);
  }
  if (format.backgroundColor === undefined) return undefined;
  const hex = rgbHex(format.backgroundColor);
  if (!hex) throw new SheetReadError(`Invalid Submission ID color at row ${rowNumber}.`);
  return hex;
}

/** Dependency overrides isolate fictional API responses in tests. */
export function createSheetReader(overrides: Partial<ReaderDependencies> = {}) {
  const request: typeof fetch = overrides.request ?? ((input, init) => fetch(input, init));
  const token = overrides.getAccessToken ?? createTokenProvider(request);
  const yellow = overrides.cancellationYellow === undefined ? REFERRAL_CANCELLATION_YELLOW : overrides.cancellationYellow;
  return async (source: SheetSource, options: ReadSheetOptions = {}): Promise<ReadSheetResult> => {
    validate(source, options, yellow);
    const mapping = SHEET_MAPPINGS.find((candidate) => candidate.key === source.key);
    if (!mapping || mapping.jotformFormId !== source.jotformFormId
      || mapping.location !== source.location || mapping.sourceType !== source.sourceType
      || mapping.submissionIdHeader !== source.submissionIdHeader
      || mapping.submissionDateHeader !== source.submissionDateHeader) {
      throw new SheetReadError("No matching calculation mapping is configured for this source.");
    }
    const accessToken = await token(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "");
    const get = async (start: number, end: number, columnRanges?: { startColumnIndex: number; endColumnIndex: number }[]) => {
      const body = await requestJson(request, `https://sheets.googleapis.com/v4/spreadsheets/${source.spreadsheetId}:getByDataFilter?fields=${encodeURIComponent(fields)}`, {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dataFilters: (columnRanges ?? [undefined]).map((columns) => ({
            gridRange: { sheetId: source.tabId, startRowIndex: start, endRowIndex: end, ...columns },
          })),
          includeGridData: true,
        }),
      }, "Google Sheets read");
      return parseGrid(body, source, start, end);
    };
    const headerGrid = await get(0, 1);
    const headerCells = headerGrid.rows.get(0) ?? new Map<number, Cell>();
    const columns: { header: string; index: number }[] = [];
    const seenHeaders = new Set<string>();
    for (let index = 0; index < headerGrid.columnCount; index++) {
      const header = cellText(headerCells.get(index), 1, index);
      if (!header.trim()) continue;
      const name = header.trim().toLowerCase();
      if (seenHeaders.has(name)) throw new SheetReadError(`Ambiguous duplicate header in row 1, column ${index + 1}.`);
      seenHeaders.add(name); columns.push({ header, index });
    }
    const required = (header: string) => {
      const column = columns.find((c) => c.header.trim().toLowerCase() === header.trim().toLowerCase());
      if (!column) throw new SheetReadError(`Missing required header: ${header}.`);
      return column;
    };
    const selected = new Map<number, string>();
    for (const header of [source.submissionIdHeader, source.submissionDateHeader, ...Object.values(mapping.answerHeaders)]) {
      const column = required(header);
      selected.set(column.index, column.header);
    }
    // Size columns support classification fallbacks when available.
    for (const header of mapping.extraHeaders ?? []) {
      const column = columns.find(
        (entry) =>
          entry.header.trim().toLowerCase() === header.toLowerCase(),
      );

      if (column) {
        selected.set(column.index, column.header);
      }
    }
    const selectedColumns = [...selected].sort(([a], [b]) => a - b);
    const selectedIndexes = selectedColumns.map(([index]) => index);
    const columnRanges: { startColumnIndex: number; endColumnIndex: number }[] = [];
    for (const index of selectedIndexes) {
      const last = columnRanges.at(-1);
      if (last && last.endColumnIndex === index) last.endColumnIndex++;
      else columnRanges.push({ startColumnIndex: index, endColumnIndex: index + 1 });
    }
    const idColumn = required(source.submissionIdHeader);
    // The bound applies to physical rows after the header. Empty rows do not
    // trigger replacement reads beyond the requested sample.
    const end = Math.min(headerGrid.rowCount, options.limit === undefined ? headerGrid.rowCount : options.limit + 1);
    const rows: SheetRow[] = [], seenIds = new Map<string, number>();
    for (let start = 1; start < end; start += pageSize) {
      const grid = await get(start, Math.min(start + pageSize, end), columnRanges);
      if (grid.rowCount !== headerGrid.rowCount || grid.columnCount !== headerGrid.columnCount) throw new SheetReadError("Sheet dimensions changed during reading; retry the read.");
      for (const [rowIndex, cells] of [...grid.rows].sort(([a], [b]) => a - b)) {
        const rowNumber = rowIndex + 1;
        if (selectedIndexes.every((column) => cellText(cells.get(column), rowNumber, column).trim() === "")) continue;
        const idCell = cells.get(idColumn.index);
        const entered = idCell?.userEnteredValue, effective = idCell?.effectiveValue;
        if (!isRecord(entered) || typeof entered.stringValue !== "string" || !/^\d+$/.test(entered.stringValue)
          || !isRecord(effective) || effective.stringValue !== entered.stringValue) {
          throw new SheetReadError(`Submission ID at row ${rowNumber} must be exact plain text digits. Numeric, formula, scientific-notation or rounded IDs are not accepted; restore IDs from the original source.`);
        }
        const id = entered.stringValue;
        const previous = seenIds.get(id);

        if (previous !== undefined) {
          console.warn(
              `${source.key}: duplicate submission ID ${id}; kept row ${previous}, skipped row ${rowNumber}.`,
          );
          continue;
        }

        seenIds.set(id, rowNumber);
        const values = Object.fromEntries(selectedColumns.map(([index, header]) => [
          header, cellText(cells.get(index), rowNumber, index),
        ]));
        rows.push({ rowNumber, values, cancelled: source.sourceType === "REFERRAL" && background(idCell, grid.theme.size ? grid.theme : headerGrid.theme, rowNumber) === yellow?.toLowerCase() });
      }
    }
    return { sourceKey: source.key, rows };
  };
}

/** Read only: no Jotform API, normalization, quantity calculation or database client. */
export const readSheet: (source: SheetSource, options?: ReadSheetOptions) => Promise<ReadSheetResult> = createSheetReader();
