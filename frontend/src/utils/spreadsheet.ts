import readXlsxFile from 'read-excel-file';

export type SpreadsheetCell = string | number | boolean | Date | null;
export type SpreadsheetRow = Record<string, SpreadsheetCell>;

export function normalizeColumnName(value: string) {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); if (row.some(cell => cell.trim() !== '')) rows.push(row); row = []; value = '';
    } else value += char;
  }
  row.push(value); if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

export async function readSpreadsheet(file: File): Promise<SpreadsheetRow[]> {
  let matrix: SpreadsheetCell[][];
  if (file.name.toLowerCase().endsWith('.csv')) matrix = parseCsv(await file.text());
  else if (file.name.toLowerCase().endsWith('.xlsx')) matrix = await readXlsxFile(file) as SpreadsheetCell[][];
  else throw new Error('Supported spreadsheet formats are CSV and XLSX.');
  const [header = [], ...rows] = matrix;
  const names = header.map(value => normalizeColumnName(String(value || '')));
  if (!names.some(Boolean)) throw new Error('The spreadsheet needs a header row.');
  return rows.map(row => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ''])));
}

function csvCell(value: SpreadsheetCell | undefined) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadSpreadsheetTemplate(filename: string, rows: SpreadsheetRow[]) {
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const csv = [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename.replace(/\.xlsx$/i, '.csv');
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function optionalNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}
