export function printAlignedTable(rows: readonly (readonly string[])[]): void {
  if (rows.length === 0) return;
  const colWidths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i] ?? 0, (row[i] ?? '').length);
    }
  }
  for (const row of rows) {
    const line = row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(colWidths[i] ?? 0)))
      .join('  ');
    console.log(line);
  }
}
