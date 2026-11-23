import XLSX from "xlsx-js-style";
import { collapseDailyEntries } from "./dsm-parser.js";
import {
  decisionRows,
  decideTimes,
  targetDateForTicket,
  latestGitHubStatus,
  localDate,
  transitionTarget,
  RULE_VERSION,
} from "./activity-matcher.js";
import { normalizeGitHubUrl } from "./github-url.js";
import { normalizePerson } from "./person.js";
import { systemType, ticketType, weekOfMonth } from "./kpi-fields.js";
function findHeaderRow(matrix) {
  return matrix.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.some((cell) => ["ticket url", "url"].includes(cell)) &&
      normalized.some((cell) => ["start time", "start"].includes(cell))
    );
  });
}
function findColumn(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}
function ticketTitleFor(entry, scans) {
  // GitHub is the canonical issue title; DSM headings are a fallback.
  return String(scans[entry.ticketUrl]?.title || entry.ticketTitle || "").trim();
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
  const widths = [14, 14, 58, 58, 14, 20, 14, 14, 12, 22, 22, 12];
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:L${Math.max(1, rowCount + 1)}` };
  const border = {
    top: { style: "thin", color: { rgb: "D0D7DE" } },
    bottom: { style: "thin", color: { rgb: "D0D7DE" } },
    left: { style: "thin", color: { rgb: "D0D7DE" } },
    right: { style: "thin", color: { rgb: "D0D7DE" } },
  };
  for (let col = 0; col < 12; col += 1) {
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
    for (let col = 0; col < 12; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      cell.s = {
        alignment: { vertical: "top", wrapText: true },
        border,
        fill: row % 2 === 0 ? { fgColor: { rgb: "F7FAFC" } } : undefined,
      };
      if (col === 11 && cell.t === "n") cell.z = "0.00";
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
function formulaCell(sheet, row, col, formula, cached) {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const previous = sheet[address] || {};
  sheet[address] = { ...previous, f: formula, v: cached, t: typeof cached === "number" ? "n" : "s" };
  delete sheet[address].w;
}
function kpiLayout(wb) {
  const name = wb.SheetNames.find((n) => /^kpi$/i.test(n));
  const sheet = wb.Sheets[name];
  if (!sheet) return null;
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const header = findHeaderRow(matrix);
  if (header < 0) return null;
  const names = matrix[header].map(normalizeHeader);
  const col = (aliases) => findColumn(names, aliases);
  const rows = [];
  for (let r = header + 1; r < matrix.length; r++)
    if (normalizeGitHubUrl(String(matrix[r][col(["ticket url", "url"])] || ""))) rows.push(r);
  return { name, sheet, matrix, header, rows, pic: col(["assignee", "pic"]),
    url: col(["ticket url", "url"]), start: col(["start time", "start"]),
    end: col(["end time", "end"]), hour: col(["hour", "hours", "durasi"]) };
}
const manualHeaders = ["_GitubGen Start", "_GitubGen End", "_GitubGen Hour",
  "_GitubGen Parsed Start", "_GitubGen Parsed End", "_GitubGen Manual Hour", "_GitubGen PIC"];
function normalizedPicFormula(input) {
  const cleaned = `LOWER(SUBSTITUTE(SUBSTITUTE(TRIM(${input})," ",""),"gobimbel",""))`;
  return `IF(OR(${cleaned}="allif",${cleaned}="allief"),"Allief",IF(OR(${cleaned}="dwiki",${cleaned}="dwiky",${cleaned}="dwikyananditya"),"Dwiky",IF(${cleaned}="maslanadev","Maulana",TRIM(${input}))))`;
}
function parsedTimeFormula(input) {
  return `IF(${input}="","",IF(ISNUMBER(${input}),${input},IFERROR(DATE(VALUE(MID(${input},7,4)),VALUE(MID(${input},4,2)),VALUE(LEFT(${input},2)))+TIME(VALUE(MID(${input},12,2)),VALUE(MID(${input},15,2)),IFERROR(VALUE(MID(${input},18,2)),0)),"")))`;
}
function manualHourFormula(start, end) {
  const day = `WEEKDAY(${start},2)`;
  const from = `MAX(MOD(${start},1),TIME(9,0,0))`;
  const to = `MIN(MOD(${end},1),IF(${day}=6,TIME(16,0,0),TIME(17,0,0)))`;
  const breakFrom = `IF(${day}=5,TIME(11,30,0),TIME(12,0,0))`;
  const breakTo = `IF(${day}=5,TIME(13,30,0),TIME(13,0,0))`;
  const breakHours = `MAX(0,MIN(${to},${breakTo})-MAX(${from},${breakFrom}))`;
  return `IF(OR(${start}="",${end}=""),"",IF(OR(INT(${start})<>INT(${end}),${end}<${start}),"",IF(${day}=7,0,ROUND(MAX(0,(${to}-${from}-${breakHours})*24),10))))`;
}
function installDynamicKpiHours(wb) {
  const layout = kpiLayout(wb);
  if (!layout || layout.hour < 0 || layout.start < 0 || layout.end < 0) return;
  const { sheet, header, rows, matrix } = layout;
  const existing = matrix[header].map(normalizeHeader).indexOf(normalizeHeader(manualHeaders[0]));
  const base = existing >= 0 ? existing : XLSX.utils.decode_range(sheet["!ref"]).e.c + 1;
  const letter = (c, r) => XLSX.utils.encode_cell({ r, c });
  for (let i = 0; i < manualHeaders.length; i++) {
    setCell(sheet, header, base + i, manualHeaders[i]);
    sheet["!cols"] ||= [];
    sheet["!cols"][base + i] = { hidden: true, wch: 3 };
  }
  for (const r of rows) {
    const original = sheet[letter(layout.hour, r)];
    if (layout.pic >= 0) formulaCell(sheet, r, base + 6,
      normalizedPicFormula(letter(layout.pic, r)), displayAssignee(matrix[r][layout.pic]));
    if (original?.f) continue; // Respect human formulas and formulas from earlier exports.
    const start = letter(layout.start, r), end = letter(layout.end, r), hour = letter(layout.hour, r);
    const [savedStart, savedEnd, savedHour, parsedStart, parsedEnd, manualHour] =
      manualHeaders.map((_, i) => letter(base + i, r));
    if (existing < 0 || !sheet[savedStart]) {
      setCell(sheet, r, base, sheet[start]?.v ?? "");
      setCell(sheet, r, base + 1, sheet[end]?.v ?? "");
      setCell(sheet, r, base + 2, original?.v ?? "", typeof original?.v === "number" ? "n" : "s");
    }
    formulaCell(sheet, r, base + 3, parsedTimeFormula(start), "");
    formulaCell(sheet, r, base + 4, parsedTimeFormula(end), "");
    formulaCell(sheet, r, base + 5, manualHourFormula(parsedStart, parsedEnd), "");
    formulaCell(sheet, r, layout.hour,
      `IF(AND(${start}=${savedStart},${end}=${savedEnd}),IF(ISNUMBER(${savedHour}),${savedHour},""),IF(OR(${start}="",${end}=""),"",${manualHour}))`,
      original?.v ?? "");
    sheet[hour].z = "0.00";
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  range.e.c = Math.max(range.e.c, base + manualHeaders.length - 1);
  sheet["!ref"] = XLSX.utils.encode_range(range);
}
function kpiTicketRanges(wb) {
  const layout = kpiLayout(wb);
  if (!layout || layout.hour < 0 || layout.pic < 0) return null;
  const quote = `'${layout.name.replaceAll("'", "''")}'!`;
  const end = Math.max(layout.header + 2, ...layout.rows.map((r) => r + 1));
  const range = (col) => `${quote}$${XLSX.utils.encode_col(col)}$${layout.header + 2}:$${XLSX.utils.encode_col(col)}$${end}`;
  const helper = matrixHelperPic(layout);
  return { pic: range(helper >= 0 ? helper : layout.pic), url: range(layout.url), hour: range(layout.hour) };
}
function matrixHelperPic(layout) {
  return layout.matrix[layout.header].map(normalizeHeader).indexOf(normalizeHeader(manualHeaders[6]));
}
const GUIDE_MARKER = "PANDUAN GITUBGEN";
const sheetGuides = {
  KPI: [
    ["Isi baris", "Satu baris = satu PIC + URL tiket + tanggal DSM. Dua sesi pada tanggal yang sama digabung; Status adalah status dari DSM pada hari itu."],
    ["Sumber tanggal", "Date berasal dari DSM; Target Date dari field Project 11. Start Time dan End Time memakai bukti aktivitas GitHub/Recorder pada hari kerja tersebut, ditampilkan dalam WIB."],
    ["Rumus Hour", "Hour = jumlah detik efektif dari interval kerja In Progress yang terbukti / 3600. Jam kerja: Senin-Jumat 09.00-17.00, Sabtu 09.00-16.00; istirahat biasa 12.00-13.00, Jumat 11.30-13.30."],
    ["Edit manual", "Jika Start Time atau End Time diedit, Hour dihitung ulang dari pasangan waktu WIB pada hari yang sama, dibatasi jam kerja dan istirahat. Nilai awal dari scan tetap dipakai selama kedua waktu belum diubah. Hapus salah satu waktu untuk mengosongkan Hour."],
    ["Workbook impor", "Pada mode isi field kosong, nilai KPI yang sudah ada dipertahankan. Rumus di sel yang sudah ada tetap dilindungi; Hour baru yang ditambahkan menjadi dinamis."],
  ],
  Diagnostic: [
    ["Isi baris", "Satu baris Diagnostic merujuk ke nomor baris KPI di kolom KPI Row; Row ID adalah gabungan PIC, URL tiket, dan tanggal."],
    ["Dasar Hour", "Seconds dan Hour berasal dari interval kerja efektif dalam kolom Intervals (JSON). Hour = Seconds / 3600; angka tanpa bukti interval lengkap tetap kosong."],
    ["Rule dan Flags", "Rule menjelaskan cara keputusan dibuat; Flags menunjukkan keterbatasan bukti. Needs Review = YES meminta pemeriksaan manual, bukan otomatis menyatakan nilai salah."],
    ["Sumber bukti", "Start Source dan End Source menunjukkan asal keputusan waktu. Coverage, Relationship Paths, dan Scan At membantu menelusuri kelengkapan scan serta relasi tiket/PR."],
    ["Waktu", "Date dan waktu Start/End ditampilkan dalam WIB. Scan At adalah waktu pengambilan data dalam UTC; Rule Version menunjukkan versi aturan generator."],
  ],
  "Rekap Tiket Unik": [
    ["Satu tiket", "Satu baris = satu PIC + URL tiket dari DSM. Date DSM adalah tanggal paling awal tiket itu muncul dalam DSM yang digenerate, termasuk pekerjaan dari bulan sebelumnya bila ada."],
    ["Tanggal Project", "Start Date dan Target Date diambil langsung dari field GitHub Project 11 saat scan; kosong jika field tidak tersedia atau Project tidak dapat dibaca."],
    ["End Date", "Tanggal WIB saat tiket pertama kali berpindah ke Staging atau Deployed pada riwayat Project 11. Ini bukan End Time baris KPI atau waktu tiket ditutup."],
    ["Total Hour", "Rumus menjumlahkan Hour di KPI dengan PIC dan URL tiket yang sama. Saat Hour KPI berubah, Total Hour ikut berubah. Kosong jika belum ada angka; angka 0 tetap dihitung."],
    ["Cakupan Hour", "Rumus menghitung baris KPI yang memiliki angka Hour untuk PIC+tiket tersebut, misalnya 2/3 baris KPI. Saat Hour manual berubah, cakupan ikut diperbarui."],
    ["Ketepatan", "Rumus membandingkan End Date dan Target Date: Tepat Waktu jika End Date <= Target Date; Melewati Target jika lebih lambat. Tanpa Target jika target kosong; Belum Ada End Date jika belum ada transisi selesai. Perubahan End Time KPI tidak mengubah End Date Project."],
    ["Status dan closed", "Status adalah status terakhir Project 11 (fallback riwayat/DSM). Tiket Closed berasal dari status issue ditutup; Status As Of (UTC) adalah waktu status dibaca, bukan waktu perubahan status."],
  ],
  Resume: [
    ["Unit hitung", "Satu baris per PIC. Total Task menghitung baris tiket unik pada Rekap Tiket Unik, sehingga pengulangan tiket di beberapa hari KPI tidak menambah jumlah task."],
    ["Done / Closed", "Jumlah tiket unik yang issue GitHub-nya ditutup. Staging dan Ready to Review menghitung status terakhir tiket saat scan, bukan seluruh tiket yang pernah melewati tahap itu."],
    ["Ketepatan", "Tepat Waktu dan Melewati Target menghitung kategori Ketepatan per tiket unik di Rekap; tanggal pembanding adalah Staging/Deployed pertama dalam WIB terhadap Target Date Project 11."],
    ["Tanpa Target", "Jumlah tiket unik yang Target Date-nya kosong. Tiket dengan target tetapi belum punya End Date tidak termasuk tiga kolom kategori ketepatan sampai ada bukti transisinya."],
    ["Pembaruan", "Angka Resume memakai rumus dari Rekap Tiket Unik. Edit tanggal, status, dan Tiket Closed di Rekap akan memperbarui hitungan saat Excel menghitung ulang. Perubahan baru di GitHub tetap memerlukan scan ulang."],
  ],
  Evidence: [
    ["Isi baris", "Catatan aktivitas mentah dari scan untuk tiket DSM beserta tiket/PR terkait; URL yang muncul tidak semuanya menjadi task unik pada Resume."],
    ["Sumber dan tipe", "Source menunjukkan GraphQL GitHub atau Recorder; Type membedakan transisi status, issue closed/reopened, komentar, commit, PR, assignment, dan hubungan tiket."],
    ["Timestamp", "Timestamp UTC adalah waktu peristiwa yang tercatat, bukan waktu scan. Untuk membandingkan tanggal DSM/End Date, GitubGen mengonversinya ke WIB (UTC+7)."],
    ["Status", "Previous Status dan Status merekam transisi; hanya status Project 11 yang relevan untuk End Date pertama. Riwayat semua URL terkait tetap tersimpan untuk audit."],
    ["Observasi", "Raw Observations menyimpan pengamatan sumber untuk event yang dikorelasikan. Event yang hanya berupa observasi/komentar tidak otomatis menjadi durasi kerja."],
  ],
  "Run Metadata": [
    ["Rule Version", "Versi aturan GitubGen yang menghasilkan workbook. Bila versi berubah, jalankan scan ulang sebelum mengekspor."],
    ["Exported At", "Waktu pembuatan file dalam UTC (akhiran Z). Tanggal kerja dan End Date pada laporan memakai zona Asia/Jakarta (WIB)."],
    ["Hour policy", "Ringkasan aturan jam kerja efektif untuk KPI; detail interval, sumber waktu, dan alasan review tersedia di Diagnostic."],
    ["Import policy", "Workbook KPI lama dilengkapi pada field kosong secara default; perubahan nilai yang sudah terisi butuh mode rekonsiliasi dan pilihan baris yang disetujui."],
    ["KPI denominator", "GitubGen tidak membagi jam untuk dua tiket dengan interval yang bertumpuk. Jika ada overlap, periksa Flags di Diagnostic."],
  ],
};
function appendSheetGuide(sheet, notes) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  let row = -1;
  for (let r = 0; r <= range.e.r; r++)
    if (sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v === GUIDE_MARKER) {
      row = r;
      break;
    }
  if (row < 0) row = range.e.r + 2; // One blank row separates data and guidance.
  const visibleEnd = sheet["!autofilter"] ? XLSX.utils.decode_range(sheet["!autofilter"].ref).e.c : range.e.c;
  const lastCol = Math.max(1, visibleEnd);
  setCell(sheet, row, 0, GUIDE_MARKER);
  const heading = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
  heading.s = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1F4E78" } },
  };
  sheet["!rows"] ||= [];
  sheet["!rows"][row] = { hpt: 25 };
  sheet["!merges"] ||= [];
  for (const [index, [label, explanation]] of notes.entries()) {
    const r = row + index + 1;
    setCell(sheet, r, 0, label);
    setCell(sheet, r, 1, explanation);
    sheet[XLSX.utils.encode_cell({ r, c: 0 })].s = {
      font: { bold: true, color: { rgb: "17324F" } },
      fill: { fgColor: { rgb: index % 2 ? "F5F8FC" : "E9F1F7" } },
      alignment: { vertical: "top", wrapText: true },
    };
    sheet[XLSX.utils.encode_cell({ r, c: 1 })].s = {
      fill: { fgColor: { rgb: index % 2 ? "F5F8FC" : "E9F1F7" } },
      alignment: { vertical: "top", wrapText: true },
    };
    if (lastCol > 1 && !sheet["!merges"].some((m) =>
      m.s.r === r && m.e.r === r && m.s.c === 1 && m.e.c === lastCol))
      sheet["!merges"].push({ s: { r, c: 1 }, e: { r, c: lastCol } });
    const estimatedLineWidth = lastCol === 1 ? 95 : lastCol * 10;
    sheet["!rows"][r] = {
      hpt: Math.max(32, Math.ceil(explanation.length / estimatedLineWidth) * 18),
    };
  }
  if (lastCol === 1) {
    sheet["!cols"] ||= [];
    sheet["!cols"][0] ||= { wch: 24 };
    sheet["!cols"][1] = { wch: 115 };
  }
  range.e.r = Math.max(range.e.r, row + notes.length);
  range.e.c = Math.max(range.e.c, lastCol);
  sheet["!ref"] = XLSX.utils.encode_range(range);
}
function finish(wb, diagnostics, entries, scans, imported = false) {
  installDynamicKpiHours(wb);
  wb.Workbook ||= {};
  wb.Workbook.CalcPr = { calcMode: "auto", fullCalcOnLoad: true, forceFullCalc: true };
  const sheet = XLSX.utils.aoa_to_sheet([diagnosticHeaders, ...diagnostics]);
  sheet["!cols"] = diagnosticHeaders.map((h, i) => ({
    wch: [0, 2, 3, 8, 9, 12, 13, 18, 19].includes(i) ? 16 : 42,
  }));
  sheet["!autofilter"] = { ref: `A1:X${diagnostics.length + 1}` };
  attachSheet(wb, "Diagnostic", sheet);
  appendUniqueTicketsSheet(wb, entries, scans);
  appendResumeSheet(wb);
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
  for (const [name, notes] of Object.entries(sheetGuides)) {
    const target = name === "KPI"
      ? wb.Sheets[wb.SheetNames.find((n) => /^kpi$/i.test(n))]
      : wb.Sheets[name];
    const guide = name === "KPI" && !imported
      ? [...notes.slice(0, -1), ["Workbook baru",
          "Tanpa unggah Excel lama, semua baris KPI dibuat dari DSM dan scan GitHub/Recorder. Setelah waktu diedit manual, Hour dan rekap yang memakai Hour dihitung ulang oleh Excel."]]
      : notes;
    if (target) appendSheetGuide(target, guide);
  }
}
export function createWorkbookFromDsm(entries, scans) {
  const daily = prepareDailyEntries(entries),
    models = decisionRows(daily, scans),
    wb = XLSX.utils.book_new(),
    diagnostics = [];
  const rows = models.map(({ entry: e, decision: d }, i) => {
    diagnostics.push(diagnosticsRow(i + 2, e, d, scans));
    const title = ticketTitleFor(e, scans);
    return [
      displayAssignee(e.assignee),
      systemType(title),
      title,
      e.ticketUrl,
      ticketType(title),
      e.status,
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
function kpiHourTotals(wb) {
  const sheet = wb.Sheets[wb.SheetNames.find((name) => /^kpi$/i.test(name))];
  if (!sheet) return new Map();
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const header = findHeaderRow(matrix);
  if (header < 0) return new Map();
  const names = matrix[header].map(normalizeHeader);
  const picCol = findColumn(names, ["assignee", "pic"]);
  const urlCol = findColumn(names, ["ticket url", "url"]);
  const hourCol = findColumn(names, ["hour", "hours", "durasi"]);
  const totals = new Map();
  if (urlCol < 0 || hourCol < 0) return totals;
  for (const row of matrix.slice(header + 1)) {
    const url = normalizeGitHubUrl(String(row[urlCol] || ""));
    if (!url) continue;
    const key = `${normalizePerson(row[picCol] || "")}|${url}`;
    const item = totals.get(key) || { total: 0, known: 0, rows: 0 };
    item.rows++;
    const raw = row[hourCol];
    if (raw !== "" && raw != null && Number.isFinite(Number(raw))) {
      item.total += Number(raw);
      item.known++;
    }
    totals.set(key, item);
  }
  return totals;
}
function firstDeliveryDate(scan) {
  const events = (scan?.events || [])
    .filter((event) => event.datetime &&
      ["staging", "deployed"].includes(transitionTarget(event)))
    .sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  return localDate(events[0]?.datetime) || "";
}
function isTicketClosed(scan) {
  if (scan?.closedAt) return true;
  const states = (scan?.events || [])
    .filter((event) => event.type === "issue_state" &&
      ["closed", "open"].includes(event.state) && event.datetime)
    .sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  return states.at(-1)?.state === "closed";
}
function styleReportSheet(sheet, rowCount, columnCount) {
  const border = {
    bottom: { style: "thin", color: { rgb: "DCE5ED" } },
  };
  for (let c = 0; c < columnCount; c++) {
    const header = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    header.s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1F4E78" } },
      alignment: { vertical: "center", wrapText: true },
      border,
    };
    for (let r = 1; r <= rowCount; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = {
        fill: { fgColor: { rgb: r % 2 ? "FFFFFF" : "F2F7FB" } },
        alignment: { vertical: "center" },
        border,
      };
      if (cell?.t === "n" && c === 9 && columnCount === 16) cell.z = "0.00";
    }
  }
  sheet["!rows"] = [{ hpt: 32 }, ...Array.from({ length: rowCount }, () => ({ hpt: 25 }))];
}
function appendUniqueTicketsSheet(wb, entries, scans) {
  const groups = new Map();
  for (const e of entries) {
    const k = `${normalizePerson(e.assignee)}|${e.ticketUrl}`;
    groups.set(k, [...(groups.get(k) || []), e]);
  }
  const hoursByTicket = kpiHourTotals(wb);
  const rows = [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date)),
      e = sorted[0],
      title = ticketTitleFor(e, scans),
      last = sorted.at(-1),
      latestStatus = latestGitHubStatus(e.ticketUrl, scans),
      statusSource = scans[e.ticketUrl]?.currentProjectStatus
        ? "GitHub Project 11 (current)"
        : latestStatus
          ? "GitHub/Recorder history"
          : "DSM fallback",
      date = e.date,
      startDate = scans[e.ticketUrl]?.startDate || "",
      targetDate = targetDateForTicket(e.ticketUrl, scans),
      endDate = firstDeliveryDate(scans[e.ticketUrl]),
      hours = hoursByTicket.get(`${normalizePerson(e.assignee)}|${e.ticketUrl}`),
      timeliness = !targetDate ? "Tanpa Target" : !endDate
        ? "Belum Ada End Date" : endDate <= targetDate
          ? "Tepat Waktu" : "Melewati Target";
    return [
      displayAssignee(e.assignee),
      systemType(title),
      title,
      e.ticketUrl,
      displayStatus(latestStatus || last.status),
      displayDate(date),
      displayDateOrBlank(startDate),
      displayDateOrBlank(targetDate),
      displayDateOrBlank(endDate),
      hours?.known ? hours.total : "",
      timeliness,
      isTicketClosed(scans[e.ticketUrl]) ? "Ya" : "Tidak",
      hours ? `${hours.known}/${hours.rows} baris KPI` : "0/0 baris KPI",
      weekOfMonth(date),
      latestStatus ? scans[e.ticketUrl]?.collectedAt || "" : "",
      statusSource,
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "Nama PIC",
      "Type",
      "Ticket Title",
      "Ticket URL",
      "Status",
      "Date DSM",
      "Start Date",
      "Target Date",
      "End Date",
      "Total Hour",
      "Ketepatan",
      "Tiket Closed",
      "Cakupan Hour",
      "Week",
      "Status As Of (UTC)",
      "Status Source",
    ],
    ...rows,
  ]);
  sheet["!cols"] = [14, 14, 58, 58, 20, 14, 14, 14, 14, 14, 22, 15, 19, 12, 25, 30].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:P${rows.length + 1}` };
  styleReportSheet(sheet, rows.length, 16);
  const ranges = kpiTicketRanges(wb);
  for (let r = 1; r <= rows.length; r++) {
    const n = r + 1;
    if (ranges) {
      const { pic, url, hour } = ranges;
      const condition = `(${pic}=$A${n})*(${url}=$D${n})`;
      const known = `SUMPRODUCT(${condition}*ISNUMBER(${hour}))`;
      formulaCell(sheet, r, 9, `IF(${known}=0,"",SUMIFS(${hour},${pic},$A${n},${url},$D${n}))`, rows[r - 1][9]);
      sheet[`J${n}`].z = "0.00";
      formulaCell(sheet, r, 12, `${known}&"/"&COUNTIFS(${pic},$A${n},${url},$D${n})&" baris KPI"`, rows[r - 1][12]);
    }
    const dateNumber = (cell) => `IF(ISNUMBER(${cell}),INT(${cell}),DATE(VALUE(RIGHT(${cell},4)),VALUE(MID(${cell},4,2)),VALUE(LEFT(${cell},2))))`;
    formulaCell(sheet, r, 10,
      `IF(H${n}="","Tanpa Target",IF(I${n}="","Belum Ada End Date",IF(${dateNumber(`I${n}`)}<=${dateNumber(`H${n}`)},"Tepat Waktu","Melewati Target")))`,
      rows[r - 1][10]);
  }
  attachSheet(wb, "Rekap Tiket Unik", sheet);
}
function appendResumeSheet(wb) {
  const details = XLSX.utils.sheet_to_json(wb.Sheets["Rekap Tiket Unik"], { defval: "" });
  const pics = [...new Set(details.map((row) => row["Nama PIC"]).filter(Boolean))];
  const rows = pics.map((pic, index) => {
    const tickets = details.filter((row) => row["Nama PIC"] === pic);
    const count = (column, value) => tickets.filter((row) => row[column] === value).length;
    return [index + 1, pic, tickets.length, count("Tiket Closed", "Ya"),
      count("Status", "Staging"), count("Status", "Ready to Review"),
      count("Ketepatan", "Tepat Waktu"), count("Ketepatan", "Melewati Target"),
      count("Ketepatan", "Tanpa Target")];
  });
  const sheet = XLSX.utils.aoa_to_sheet([["No", "Nama PIC", "Total Task", "Done / Closed",
    "Staging", "Ready to Review", "Tepat Waktu", "Melewati Target", "Tanpa Target"], ...rows]);
  sheet["!cols"] = [7, 18, 15, 17, 14, 19, 17, 20, 17].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:I${rows.length + 1}` };
  styleReportSheet(sheet, rows.length, 9);
  const last = Math.max(2, details.length + 1);
  const rekap = "'Rekap Tiket Unik'!";
  const range = (col) => `${rekap}$${col}$2:$${col}$${last}`;
  for (let r = 1; r <= rows.length; r++) {
    const n = r + 1;
    const pic = range("A");
    const formulas = [
      `COUNTIF(${pic},$B${n})`,
      `COUNTIFS(${pic},$B${n},${range("L")},"Ya")`,
      `COUNTIFS(${pic},$B${n},${range("E")},"Staging")`,
      `COUNTIFS(${pic},$B${n},${range("E")},"Ready to Review")`,
      ...["Tepat Waktu", "Melewati Target", "Tanpa Target"].map((status) =>
        `COUNTIFS(${pic},$B${n},${range("K")},"${status}")`),
    ];
    formulas.forEach((f, i) => formulaCell(sheet, r, i + 2, f, rows[r - 1][i + 2]));
  }
  attachSheet(wb, "Resume", sheet);
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
      workbook.SheetNames.find((n) =>
        !/^(diagnostic|diagnostics|evidence|rekap tiket unik|resume|run metadata)$/i.test(n) &&
        findHeaderRow(XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1, defval: "" })) >= 0,
      ) || workbook.SheetNames[0],
    sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }),
    header = findHeaderRow(matrix);
  if (header < 0)
    throw new Error(`Header KPI tidak ditemukan di sheet "${sheetName}". Pastikan ada kolom Ticket URL/URL dan Start Time/Start.`);
  const headers = matrix[header].map(normalizeHeader),
    col = (names) => findColumn(headers, names);
  const cols = {
    assignee: col(["assignee", "pic"]),
    title: col(["ticket title", "judul tiket", "judul"]),
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
      title: ticketTitleFor(model.entry, scans),
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
      // Titles filled by humans (and formulas) must not be overwritten,
      // including in reconciliation mode.
      if (key === "title" && old !== "") continue;
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
  finish(workbook, diagnostics, daily, scans, true);
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
