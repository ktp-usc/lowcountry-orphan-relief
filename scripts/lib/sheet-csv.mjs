/** Parse RFC 4180-style CSV without discarding duplicate or empty headers. */
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let values = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        cell += c;
        if (c === "\n") line++;
      }
    } else if (c === '"' && !cell && !closed) {
      quoted = true;
    } else if (c === ",") {
      values.push(cell); cell = ""; closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      values.push(cell); rows.push({ values, rowNumber: start });
      values = []; cell = ""; closed = false; line++; start = line;
    } else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Malformed CSV quoting.");
  if (values.length || cell || closed) {
    values.push(cell); rows.push({ values, rowNumber: start });
  }
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].values;
  for (const row of rows.slice(1)) {
    if (row.values.length !== headers.length) throw new Error(`CSV column count mismatch at row ${row.rowNumber}.`);
  }
  return { headers, rows: rows.slice(1) };
}

export function formatCsv(rows) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\n") + "\n";
}
