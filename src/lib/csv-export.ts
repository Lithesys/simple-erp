export type CsvExportColumn<Row> = {
  key: string;
  label: string;
  read: (row: Row) => unknown;
};

function escapeCsvCell(value: unknown) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@]/.test(text.trimStart()))
    text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createCsv<Row>(columns: CsvExportColumn<Row>[], rows: Row[]) {
  return (
    "\ufeff" +
    [
      columns.map((column) => escapeCsvCell(column.label)).join(","),
      ...rows.map((row) =>
        columns.map((column) => escapeCsvCell(column.read(row))).join(","),
      ),
    ].join("\r\n")
  );
}

export function downloadCsvFile(filename: string, csv: string) {
  const blobUrl = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
