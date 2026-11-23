import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { createWorkbookFromDsm, fillWorkbook } from "../src/lib/workbook.js";

const url = "https://github.com/GO-Bimbel/db-go/issues/2923";
const entry = {
  assignee: "allief", ticketUrl: url, ticketTitle: "Task",
  date: "2026-10-19", session: "11:00", sessions: ["11:00"], status: "Staging",
};
const scans = {
  [url]: {
    url, title: "Task", startDate: "2026-10-18", targetDate: "2026-10-19",
    currentProjectStatus: "Deployed", closedAt: "2026-10-20T05:00:00Z",
    events: [{ type: "status", datetime: "2026-10-19T08:00:00Z",
      projectNumber: 11, status: "Staging" }],
  },
};
const expected = {
  KPI: ["Rumus Hour", "Target Date", "interval"],
  Diagnostic: ["Dasar Hour", "Coverage", "Rule"],
  "Rekap Tiket Unik": ["Total Hour", "Status As Of (UTC)", "Staging"],
  Resume: ["Done / Closed", "PIC", "ketepatan"],
  Evidence: ["Timestamp", "GraphQL", "UTC"],
  "Run Metadata": ["Exported At", "UTC", "Rule Version"],
};

function guide(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const start = rows.findIndex((row) => row[0] === "PANDUAN GITUBGEN");
  return { rows, start, text: rows.slice(start + 1).map((row) => row[0] + ": " + row[1]).join("\n") };
}

test("setiap sheet mendapat panduan yang berbeda di bawah tabel data", () => {
  const { workbook } = createWorkbookFromDsm([entry], scans);
  for (const [name, phrases] of Object.entries(expected)) {
    const sheet = workbook.Sheets[name], { rows, start, text } = guide(sheet);
    assert.ok(start >= 3, `${name}: panduan di bawah data dan satu baris kosong`);
    assert.equal(rows[start - 1].every((cell) => cell === ""), true);
    for (const phrase of phrases) assert.ok(text.includes(phrase), `${name}: ${phrase}`);
    const restored = XLSX.read(XLSX.write(workbook, { bookType: "xlsx", type: "buffer", cellStyles: true }),
      { type: "buffer", cellStyles: true });
    assert.equal(guide(restored.Sheets[name]).start, start, `${name}: panduan tersimpan di XLSX`);
  }
});

test("impor workbook hasil generate tidak menduplikasi panduan KPI atau mengubah jamnya", () => {
  const generated = createWorkbookFromDsm([entry], scans).workbook;
  const original = XLSX.read(XLSX.write(generated, {
    bookType: "xlsx", type: "buffer", cellStyles: true,
  }), { type: "buffer", cellStyles: true });
  const kpi = original.Sheets.KPI;
  const hourBefore = kpi.M2?.v;
  const start = guide(kpi).start;
  const refreshed = fillWorkbook(original, [entry], scans).workbook;
  assert.equal(guide(refreshed.Sheets.KPI).start, start);
  assert.equal(guide(refreshed.Sheets.KPI).rows.filter((row) =>
    row[0] === "PANDUAN GITUBGEN").length, 1);
  assert.equal(refreshed.Sheets.KPI.M2?.v, hourBefore);
  assert.equal(refreshed.Sheets["Rekap Tiket Unik"].D2.v, url);
});
