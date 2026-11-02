import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { decideTimes, latestGitHubStatus } from "../src/lib/activity-matcher.js";
import { normalizeActivity, PROJECT_ACTIVITY_QUERY } from "../src/lib/github-graphql.js";
import { createWorkbookFromDsm, fillWorkbook } from "../src/lib/workbook.js";

const url = "https://github.com/GO-Bimbel/go-superapp-api/issues/3983";
const entry = (extra = {}) => ({
  assignee: "allief",
  date: "2026-10-27",
  session: "11:00",
  sessions: ["11:00"],
  ticketUrl: url,
  ticketTitle: "",
  status: "In Progress",
  ...extra,
});
const change = (date, previousStatus, status) => ({
  type: "status",
  datetime: date,
  previousStatus,
  status,
  projectNumber: 11,
});
const confirmedAndOpen = [
  change("2026-10-27T04:29:43Z", "Staging", "In Progress"),
  change("2026-10-27T04:52:15Z", "In Progress", "Ready to Review"),
  change("2026-10-27T08:17:44Z", "Ready to Review", "In Progress"),
  change("2026-10-28T01:57:31Z", "In Progress", "Ready to Review"),
];

test("#3983: closed 11:29:43–11:52:15 still counts when issue resumes at 15:17:44", () => {
  const d = decideTimes(entry(), {
    [url]: { url, events: confirmedAndOpen, linkedUrls: [] },
  });
  assert.equal(d.start, "2026-10-27T04:29:43Z");
  assert.equal(d.end, "2026-10-27T04:52:15Z");
  assert.equal(d.seconds, 1352);
  assert.ok(Math.abs(d.hours - 1352 / 3600) < 1e-10);
  assert.ok(d.flags.includes("PARTIAL_OPEN_INTERVAL"));
  assert.ok(d.flags.includes("MISSING_COMPLETION"));
  assert.equal(d.intervals.length, 1);
});

test("a lone unclosed In Progress must not become a fabricated hour value", () => {
  const d = decideTimes(entry(), {
    [url]: { url, events: [confirmedAndOpen[0]], linkedUrls: [] },
  });
  assert.equal(d.end, null);
  assert.equal(d.hours, null);
});

test("GraphQL Project 11 current Status is captured without confusing Target Date", () => {
  assert.match(PROJECT_ACTIVITY_QUERY, /ProjectV2ItemFieldSingleSelectValue/);
  const d = normalizeActivity({
    data: { repository: { issue: {
      url,
      title: "[GOICONS] FIX: Rencana Rapat",
      timelineItems: { nodes: [] },
      projectItems: { nodes: [
        { project: { number: 99 }, fieldValues: { nodes: [
          { name: "Todo", field: { name: "Status" } },
        ] } },
        { project: { number: 11 }, fieldValues: { nodes: [
          { name: "Deployed", field: { name: "Status" } },
          { date: "2026-10-30", field: { name: "Target Date" } },
        ] } },
      ] },
    } } },
  }, url);
  assert.equal(d.title, "[GOICONS] FIX: Rencana Rapat");
  assert.equal(d.currentProjectStatus, "Deployed");
  assert.equal(d.targetDate, "2026-10-30");
});

test("unique tickets use the current status, not last DSM day or another Project", () => {
  const scans = {
    [url]: {
      url,
      title: "[GOICONS] FIX: Rencana Rapat",
      currentProjectStatus: "Deployed",
      collectedAt: "2026-11-02T03:00:00Z",
      events: [
        change("2026-10-27T04:29:43Z", "Todo", "In Progress"),
        change("2026-10-29T05:00:00Z", "In Progress", "Ready to Review"),
      ],
      linkedUrls: [],
    },
  };
  assert.equal(latestGitHubStatus(url, scans), "deployed");
  assert.equal(latestGitHubStatus(url, scans, "2026-10-28T00:00:00Z"), "in progress");
  const { workbook } = createWorkbookFromDsm([entry()], scans);
  assert.equal(workbook.Sheets.KPI.C2.v, scans[url].title);
  assert.equal(workbook.Sheets["Rekap Tiket Unik"].C2.v, scans[url].title);
  assert.equal(workbook.Sheets["Rekap Tiket Unik"].E2.v, "Deployed");
  assert.equal(workbook.Sheets["Rekap Tiket Unik"].J2.v, scans[url].collectedAt);
  // The daily DSM status must remain historical, not be replaced by current Project status.
  assert.equal(workbook.Sheets.KPI.F2.v, "In Progress");
});

test("legacy imported KPI fills only blank titles, preserving hand edits/formulas", () => {
  const scans = {
    [url]: { url, title: "Canonical issue title", events: [], linkedUrls: [] },
  };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Assignee", "Ticket Title", "URL", "Date", "Start", "End", "Hour"],
    ["Allief", "", url, "27/10/2026", "", "", ""],
  ]), "KPI");
  const result = fillWorkbook(book, [entry()], scans);
  assert.equal(result.workbook.Sheets.KPI.B2.v, "Canonical issue title");
  assert.equal(book.Sheets.KPI.B2?.v ?? "", "");
  result.workbook.Sheets.KPI.B2.v = "Manual title";
  const reconciled = fillWorkbook(result.workbook, [entry()], scans, { mode: "reconcile" });
  assert.equal(reconciled.workbook.Sheets.KPI.B2.v, "Manual title");
  const formula = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Assignee", "Ticket Title", "URL", "Date", "Start", "End", "Hour"],
    ["Allief", "", url, "27/10/2026", "", "", ""],
  ]);
  sheet.B2 = { t: "s", f: '"protected"', v: "" };
  XLSX.utils.book_append_sheet(formula, sheet, "KPI");
  assert.equal(fillWorkbook(formula, [entry()], scans).workbook.Sheets.KPI.B2.f, '"protected"');
});
