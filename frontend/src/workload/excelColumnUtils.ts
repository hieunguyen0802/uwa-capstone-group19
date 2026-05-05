/** Convert Excel column letters (e.g. "AE") to zero-based column index. */
export function excelColToZeroIndex(col: string): number {
  const letters = col.trim().toUpperCase();
  if (!letters.match(/^[A-Z]+$/)) return -1;
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function zeroIndexToExcelCol(zeroIdx: number): string {
  if (zeroIdx < 0 || !Number.isFinite(zeroIdx)) return "";
  let n = zeroIdx + 1;
  let out = "";
  while (n > 0) {
    const rest = Math.floor((n - 1) / 26);
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = rest;
  }
  return out;
}
