/**
 * One CSV cell for a semicolon-separated, Excel-friendly file. A value that a
 * spreadsheet would evaluate as a formula (leading =, +, -, @, tab or CR, after
 * optional whitespace) is prefixed with an apostrophe so it stays text.
 */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^\s*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
