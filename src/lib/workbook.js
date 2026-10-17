import XLSX from "xlsx-js-style";
import { collapseDailyEntries } from "./dsm-parser.js";
import {
  decisionRows,
  decideTimes,
  uniqueTicketPeriod,
  targetDateForTicket,
  latestGitHubStatus,
  localDate,
  RULE_VERSION,
} from "./activity-matcher.js";
import { normalizeGitHubUrl } from "./github-url.js";
import { normalizePerson } from "./person.js";
import { systemType, ticketType, weekOfMonth } from "./kpi-fields.js";
function findHeaderRow(matrix) {
  return matrix.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.includes("ticket url") &&
      normalized.some((cell) => cell === "start time")
    );
  });
}
function findColumn(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}
function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function normalizeDate(value) {
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const text = String(value || "").trim();
  const parts = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (parts)
    return `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  return text.slice(0, 10);
}
function formatDateTime(iso) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(iso))
    .reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function setCell(sheet, zeroRow, zeroCol, value, type = "s") {
  const address = XLSX.utils.encode_cell({ r: zeroRow, c: zeroCol });
  const previous = sheet[address] || {};
  sheet[address] = { ...previous, v: value, t: type };
  delete sheet[address].w;
}
function styleKpiSheet(sheet, rowCount) {
  const widths = [14, 14, 58, 58, 14, 20, 12, 14, 14, 12, 22, 22, 12];
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:M${Math.max(1, rowCount + 1)}` };
  const border = {
    top: { style: "thin", color: { rgb: "D0D7DE" } },
    bottom: { style: "thin", color: { rgb: "D0D7DE" } },
    left: { style: "thin", color: { rgb: "D0D7DE" } },
    right: { style: "thin", color: { rgb: "D0D7DE" } },
  };
  for (let col = 0; col < 13; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
    if (cell)
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1F4E78" } },
        alignment: { horizontal: "center", vertical: "center" },
        border,
      };
  }
  for (let row = 1; row <= rowCount; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      cell.s = {
        alignment: { vertical: "top", wrapText: true },
        border,
        fill: row % 2 === 0 ? { fgColor: { rgb: "F7FAFC" } } : undefined,
      };
      if (col === 12 && cell.t === "n") cell.z = "0.00";
    }
  }
  sheet["!rows"] = [
    { hpt: 24 },
    ...Array.from({ length: rowCount }, () => ({ hpt: 34 })),
  ];
}

function prepareDailyEntries(entries) {
  return collapseDailyEntries(entries).sort((a, b) =>
    `${a.date}|${a.assignee}|${a.ticketUrl}`.localeCompare(
      `${b.date}|${b.assignee}|${b.ticketUrl}`,
    ),
  );
}
function normalizeStatusText(v = "") {
  const normalized = String(v)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^in\s*progress$/.test(normalized) ? "in progress" : normalized;
}
function displayDateOrBlank(value) {
  return value ? displayDate(value) : "";
}
function sortDateValue(value) {
  const p = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return p ? `${p[3]}-${p[2]}-${p[1]}` : String(value || "");
}
function styleDiagnosticSheet(sheet, rowCount) {
  sheet["!cols"] = [
    9, 14, 13, 20, 12, 58, 22, 22, 10, 30, 48, 18, 55, 48, 18, 55, 12, 14,
  ].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:R${Math.max(1, rowCount + 1)}` };
  for (let col = 0; col < 18; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
    if (cell)
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "44546A" } },
        alignment: { horizontal: "center", vertical: "center" },
      };
  }
}
function displayAssignee(value) {
  return (
    { allief: "Allief", hizkia: "Hizkia", maulana: "Maulana", dwiki: "Dwiky" }[
      normalizePerson(value)
    ] || value
  );
}
function displayStatus(value) {
  const normalized = normalizeStatusText(value);
  return (
    {
      todo: "Todo",
      "in progress": "In Progress",
      "ready to review": "Ready to Review",
      staging: "Staging",
      deployed: "Deployed",
    }[normalized] || value
  );
}
function displayDate(value) {
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
function generatedFileName(entries) {
  const date = collapseDailyEntries(entries)[0]?.date || "";
  const [year, month] = date.split("-");
  const months = {
    "01": "Januari",
    "02": "Februari",
    "03": "Maret",
    "04": "April",
    "05": "Mei",
    "06": "Juni",
    "07": "Juli",
    "08": "Agustus",
    "09": "September",
    10: "Oktober",
    11: "November",
    12: "Desember",
  };
  return `KPI-${months[month] || month || "Export"}-${year || "Data"}-GITUBGEN-V2.xlsx`;
}
const diagnosticHeaders = [
  "KPI Row",
  "Row ID",
  "Assignee",
  "Date",
  "DSM Sessions",
  "Ticket URL",
  "Start Time",
  "End Time",
  "Hour",
  "Seconds",
  "Rule",
  "Flags",
  "Confidence",
  "Needs Review",
  "Last Work At",
  "Intervals",
  "Start Source",
  "End Source",
  "Rule Version",
  "Project",
  "Scan At",
  "Coverage",
  "Relationship Paths",
  "Import Action",
];
const rowId = (e) => `${normalizePerson(e.assignee)}|${e.ticketUrl}|${e.date}`;
function diagnosticsRow(row, entry, d, scans, action = "GENERATED") {
  return [
    row,
    rowId(entry),
    displayAssignee(entry.assignee),
    entry.date,
    (entry.sessions || [entry.session]).filter(Boolean).join(", "),
    entry.ticketUrl,
    d.start ? formatDateTime(d.start) : "",
    d.end ? formatDateTime(d.end) : "",
    d.hours ?? "",
    d.seconds ?? "",
    d.rule,
    d.flags.join(", "),
    d.confidence,
    d.needsReview ? "YES" : "NO",
    d.lastWorkAt ? formatDateTime(d.lastWorkAt) : "",
    JSON.stringify(
      d.intervals.map((i) => ({
        start: i.start,
        end: i.end,
        seconds: i.effectiveSeconds,
        reason: i.reason,
      })),
    ),
    d.startSource || "",
    d.endSource || "",
    RULE_VERSION,
    11,
    scans[entry.ticketUrl]?.collectedAt || "",
    JSON.stringify(
      scans[entry.ticketUrl]?.sourceCoverage ||
        scans[entry.ticketUrl]?.coverage ||
        {},
    ),
    JSON.stringify(d.relationshipPaths),
    action,
  ];
}
function attachSheet(wb, name, sheet) {
  if (!wb.SheetNames.includes(name)) wb.SheetNames.push(name);
  wb.Sheets[name] = sheet;
}
function finish(wb, diagnostics, entries, scans) {
  const sheet = XLSX.utils.aoa_to_sheet([diagnosticHeaders, ...diagnostics]);
  sheet["!cols"] = diagnosticHeaders.map((h, i) => ({
    wch: [0, 2, 3, 8, 9, 12, 13, 18, 19].includes(i) ? 16 : 42,
  }));
  sheet["!autofilter"] = { ref: `A1:X${diagnostics.length + 1}` };
  attachSheet(wb, "Diagnostic", sheet);
  appendUniqueTicketsSheet(wb, entries, scans);
  const evidence = [
    [
      "Ticket URL",
      "Event ID",
      "Source",
      "Type",
      "Timestamp UTC",
      "Project",
      "Previous Status",
      "Status",
      "Actor",
      "Text",
      "Raw Observations",
    ],
  ];
  for (const [url, s] of Object.entries(scans))
    for (const e of s.events || [])
      evidence.push([
        url,
        e.id || "",
        e.source || "",
        e.type,
        e.datetime,
        e.projectNumber || "",
        e.previousStatus ?? "",
        e.status ?? "",
        e.actor || "",
        String(e.text || "").slice(0, 32000),
        JSON.stringify(e.observations || []).slice(0, 32000),
      ]);
  attachSheet(wb, "Evidence", XLSX.utils.aoa_to_sheet(evidence));
  attachSheet(
    wb,
    "Run Metadata",
    XLSX.utils.aoa_to_sheet([
      ["Property", "Value"],
      ["Rule Version", RULE_VERSION],
      ["Exported At", new Date().toISOString()],
      ["Project", 11],
      ["Timezone", "Asia/Jakarta"],
      [
        "Hour policy",
        "Sum of observed In Progress intervals, clipped to working hours and breaks. Unknown remains blank.",
      ],
      [
        "Import policy",
        "Fill empty fields by default; reconciliation requires reviewed row selection. Existing KPI coordinates and formulas remain in place.",
      ],
      [
        "KPI denominator",
        "Unchanged. No automatic division of overlapping time.",
      ],
    ]),
  );
}
export function createWorkbookFromDsm(entries, scans) {
  const daily = prepareDailyEntries(entries),
    models = decisionRows(daily, scans),
    wb = XLSX.utils.book_new(),
    diagnostics = [];
  const rows = models.map(({ entry: e, decision: d }, i) => {
    diagnostics.push(diagnosticsRow(i + 2, e, d, scans));
    return [
      displayAssignee(e.assignee),
      systemType(e.ticketTitle),
      e.ticketTitle,
      e.ticketUrl,
      ticketType(e.ticketTitle),
      e.status,
      "",
      displayDate(e.date),
      displayDateOrBlank(targetDateForTicket(e.ticketUrl, scans)),
      weekOfMonth(e.date),
      d.start ? formatDateTime(d.start) : "",
      d.end ? formatDateTime(d.end) : "",
      d.hours ?? "",
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "Assignee",
      "Type",
      "Ticket Title",
      "Ticket URL",
      "Type",
      "Status",
      "Priority",
      "Date",
      "Target Date",
      "Week",
      "Start Time",
      "End Time",
      "Hour",
    ],
    ...rows,
  ]);
  styleKpiSheet(sheet, rows.length);
  attachSheet(wb, "KPI", sheet);
  finish(wb, diagnostics, daily, scans);
  return {
    workbook: wb,
    updated: rows.length,
    skipped: 0,
    review: models.filter((m) => m.decision.needsReview).length,
    changes: [],
  };
}
function appendUniqueTicketsSheet(wb, entries, scans) {
  const groups = new Map();
  for (const e of entries) {
    const k = `${normalizePerson(e.assignee)}|${e.ticketUrl}`;
    groups.set(k, [...(groups.get(k) || []), e]);
  }
  const rows = [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date)),
      e = sorted[0],
      last = sorted.at(-1),
      period = uniqueTicketPeriod(group, scans),
      starts = group
        .map((e) => decideTimes(e, scans).start)
        .filter(Boolean)
        .sort((a, b) => +new Date(a) - +new Date(b)),
      date = localDate(starts[0]) || period.startDate;
    return [
      displayAssignee(e.assignee),
      systemType(e.ticketTitle),
      e.ticketTitle,
      e.ticketUrl,
      displayStatus(
        latestGitHubStatus(
          e.ticketUrl,
          scans,
          `${last.date}T23:59:59.999+07:00`,
        ) || last.status,
      ),
      "",
      displayDate(date),
      period.endDate ? displayDate(period.endDate) : "",
      weekOfMonth(date),
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "Assignee",
      "Type",
      "Ticket Title",
      "Ticket URL",
      "Status",
      "Priority",
      "Date",
      "End Date",
      "Week",
    ],
    ...rows,
  ]);
  sheet["!cols"] = [14, 14, 58, 58, 20, 12, 14, 14, 12].map((wch) => ({ wch }));
  attachSheet(wb, "Rekap Tiket Unik", sheet);
}
export function fillWorkbook(inputWorkbook, entries, scans, options = {}) {
  // Keep existing cell objects, formula references, hyperlinks, notes, merges and row coordinates.
  // Appending Target Date avoids shifting references. Imported KPI rows are never re-sorted.
  const workbook = structuredClone(inputWorkbook),
    daily = prepareDailyEntries(entries),
    models = decisionRows(daily, scans),
    byId = new Map(models.map((m) => [rowId(m.entry), m]));
  const sheetName =
      workbook.SheetNames.find((n) => /^kpi$/i.test(n)) ||
      workbook.SheetNames[0],
    sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }),
    header = findHeaderRow(matrix);
  if (header < 0) throw new Error("Header KPI tidak ditemukan.");
  const headers = matrix[header].map(normalizeHeader),
    col = (names) => findColumn(headers, names);
  const cols = {
    assignee: col(["assignee", "pic"]),
    url: col(["ticket url", "url"]),
    date: col(["date", "tanggal"]),
    start: col(["start time", "start"]),
    end: col(["end time", "end"]),
    hour: col(["hour", "hours", "durasi"]),
    targetDate: col(["target date"]),
    locked: col(["locked", "manual", "manual override"]),
  };
  if ([cols.url, cols.date, cols.start, cols.end].some((c) => c < 0))
    throw new Error(
      "Kolom Ticket URL, Date, Start Time, atau End Time tidak ditemukan.",
    );
  if (cols.targetDate < 0) {
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    cols.targetDate = range.e.c + 1;
    setCell(sheet, header, cols.targetDate, "Target Date");
    range.e.c++;
    sheet["!ref"] = XLSX.utils.encode_range(range);
  }
  const diagnostics = [],
    changes = [];
  let updated = 0,
    skipped = 0,
    review = 0;
  for (let r = header + 1; r < matrix.length; r++) {
    const row = matrix[r],
      url = normalizeGitHubUrl(String(row[cols.url] || ""));
    if (!url) continue;
    const e = {
        assignee: normalizePerson(row[cols.assignee]),
        ticketUrl: url,
        date: normalizeDate(row[cols.date]),
      },
      id = rowId(e),
      model = byId.get(id);
    if (!model) {
      diagnostics.push(
        diagnosticsRow(
          r + 1,
          e,
          {
            start: null,
            end: null,
            hours: null,
            seconds: null,
            rule: "UNMATCHED_DSM_ROW",
            flags: ["UNMATCHED_DSM_ROW"],
            confidence: "LOW",
            needsReview: true,
            intervals: [],
            relationshipPaths: [],
          },
          scans,
          "UNCHANGED",
        ),
      );
      review++;
      continue;
    }
    const d = structuredClone(model.decision),
      protectedRow =
        cols.locked >= 0 &&
        /^(?:yes|true|1|locked|manual)$/i.test(String(row[cols.locked] || ""));
    let action = "UNCHANGED",
      count = 0;
    const approved =
      !options.allowedRowIds || options.allowedRowIds.includes(id);
    const proposes = {
      start: d.start ? formatDateTime(d.start) : "",
      end: d.end ? formatDateTime(d.end) : "",
      hour: d.hours,
      targetDate: displayDateOrBlank(targetDateForTicket(url, scans)),
    };
    const pairMatches = ["start", "end"].every(
      (k) =>
        !row[cols[k]] || existingTime(row[cols[k]]) === String(proposes[k]),
    );
    for (const [key, proposed] of Object.entries(proposes)) {
      const value = proposed ?? "";
      const c = cols[key];
      if (
        c == null ||
        c < 0 ||
        (value === "" && (options.mode !== "reconcile" || key === "targetDate"))
      )
        continue;
      const address = XLSX.utils.encode_cell({ r, c }),
        cell = sheet[address],
        old = cell?.v ?? "";
      if (protectedRow || cell?.f) {
        d.flags.push("MANUAL_OR_FORMULA_PROTECTED");
        d.needsReview = true;
        continue;
      }
      if (key === "hour" && !pairMatches && options.mode !== "reconcile") {
        d.flags.push("EXISTING_PAIR_CONFLICT");
        d.needsReview = true;
        continue;
      }
      if (old !== "" && options.mode !== "reconcile") {
        if (
          (key === "start" || key === "end"
            ? existingTime(old)
            : String(old)) !== String(value)
        ) {
          d.flags.push("EXISTING_VALUE_CONFLICT");
          d.needsReview = true;
        }
        continue;
      }
      if (String(old) === String(value)) continue;
      changes.push({ id, row: r + 1, field: key, before: old, after: value });
      if (approved) {
        setCell(sheet, r, c, value, key === "hour" && value !== "" ? "n" : "s");
        if (key === "hour") sheet[address].z = "0.00";
        count++;
      }
    }
    if (count) {
      updated++;
      action = options.mode === "reconcile" ? "RECONCILED" : "FILLED_MISSING";
    } else {
      skipped++;
      action = protectedRow ? "PROTECTED" : "UNCHANGED_OR_DESELECTED";
    }
    if (d.needsReview) review++;
    diagnostics.push(diagnosticsRow(r + 1, model.entry, d, scans, action));
  }
  finish(workbook, diagnostics, daily, scans);
  return { workbook, updated, skipped, review, changes };
}
export {
  formatDateTime,
  displayAssignee,
  displayDate,
  displayStatus,
  generatedFileName,
  prepareDailyEntries,
};

function existingTime(value) {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}/${d.y} ${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}:${String(Math.round(d.S)).padStart(2, "0")}`;
  }
  return String(value || "").trim();
}
