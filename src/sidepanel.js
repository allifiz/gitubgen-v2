import XLSX from "xlsx-js-style";
import { collapseDailyEntries, parseDsm } from "./lib/dsm-parser.js";
import { decideTimes, decisionRows } from "./lib/activity-matcher.js";
import {
  createWorkbookFromDsm,
  fillWorkbook,
  formatDateTime,
  displayAssignee,
  displayDate,
  displayStatus,
  generatedFileName,
  prepareDailyEntries,
} from "./lib/workbook.js";
import { inputContext } from "./lib/job.js";
export { createWorkbookFromDsm, fillWorkbook } from "./lib/workbook.js";
import { normalizeGitHubUrl } from "./lib/github-url.js";
import { normalizePerson } from "./lib/person.js";
import { systemType, ticketType, weekOfMonth } from "./lib/kpi-fields.js";

const state = { entries: [], workbook: null, kpiFileName: null, job: null };
const CREDENTIALS_KEY = "gitubgenCredentials";
const $ = (selector) => document.querySelector(selector);
const dsmFile = $("#dsmFile");
const kpiFile = $("#kpiFile");
const scanButton = $("#scan");
const exportButton = $("#export");
const message = $("#message");

const guarded = (fn) => async () => {
  try {
    await fn();
  } catch (error) {
    setBusy(false);
    showError(error.message);
  }
};
dsmFile.addEventListener("change", guarded(loadDsm));
for (const input of document.querySelectorAll('[name="assignee"]'))
  input.addEventListener("change", guarded(loadDsm));
$("#depth").addEventListener("change", refreshExportState);
kpiFile.addEventListener("change", guarded(loadWorkbook));
scanButton.addEventListener("click", guarded(startScan));
exportButton.addEventListener("click", guarded(exportWorkbook));
$("#reset").addEventListener("click", resetJob);
chrome.runtime.onMessage.addListener((event) => {
  if (event.type === "JOB_PROGRESS") updateJob(event.job);
});

restoreJob();
restoreCredentials();

async function restoreCredentials() {
  const saved =
    (await chrome.storage.session.get(CREDENTIALS_KEY))[CREDENTIALS_KEY] || {};
  if (saved.githubToken) $("#githubToken").value = saved.githubToken;
  if (saved.recorderUrl||saved.url) $("#recorderUrl").value = saved.recorderUrl||saved.url;
  if (saved.recorderSecret||saved.secret) $("#recorderSecret").value = saved.recorderSecret||saved.secret;
}

async function loadDsm() {
  clearMessage();
  const file = dsmFile.files[0];
  if (!file) return;
  const selected = selectedAssignees();
  state.entries = parseDsm(await file.text(), { assignees: selected });
  if (!state.entries.length)
    showError(
      "Tidak menemukan tiket DSM lengkap dengan tanggal, sesi, dan assignee.",
    );
  else showInfo(`${state.entries.length} kemunculan tiket DSM ditemukan.`);
  if (
    state.job?.status === "completed" &&
    state.job.inputContext === inputContext(state.entries)
  )
    updateJob(state.job);
  refreshExportState();
}

async function loadWorkbook() {
  clearMessage();
  const file = kpiFile.files[0];
  if (!file) return;
  state.workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellStyles: true,
    cellDates: false,
    bookFiles: true,
  });
  const unsupported = (state.workbook.keys || []).filter(
    (k) =>
      /^xl\/(charts|drawings|pivotTables|pivotCache|activeX|embeddings)\//.test(
        k,
      ) || /vbaProject/.test(k),
  );
  if (unsupported.length) {
    state.workbook = null;
    state.kpiFileName = null;
    kpiFile.value = "";
    showError(
      "Workbook berisi chart/pivot/macro yang belum bisa dipertahankan. Impor dibatalkan; buat workbook baru dari DSM.",
    );
    return;
  }
  state.kpiFileName = file.name;
  showInfo(`Workbook ${file.name} siap.`);
  refreshExportState();
}

async function startScan() {
  clearMessage();
  if (!dsmFile.files[0]) return showError("Pilih file DSM terlebih dahulu.");
  const githubToken = $("#githubToken").value.trim();
  if (!githubToken && !$("#recorderSecret").value.trim())
    return showError(
      "Isi GitHub token read-only untuk mengambil status history GraphQL.",
    );
  const recorder = {
    url: $("#recorderUrl").value.trim(),
    secret: $("#recorderSecret").value.trim(),
  };
  if (recorder.url && recorder.secret) {
    try {
      const u = new URL(recorder.url);
      if (u.protocol !== "https:" || !u.hostname.endsWith(".vercel.app"))
        return showError(
          "Recorder URL extension harus HTTPS pada domain *.vercel.app.",
        );
    } catch {
      return showError("Recorder URL tidak valid.");
    }
  }
  await chrome.storage.session.set({
    [CREDENTIALS_KEY]: {
      githubToken,
      recorderUrl: recorder.url,
      recorderSecret: recorder.secret,
    },
  });
  await loadDsm();
  if (!state.entries.length) return;
  const grouped = new Map();
  for (const entry of collapseDailyEntries(state.entries)) {
    const current = grouped.get(entry.ticketUrl) || {
      dates: new Set(),
      targets: {},
    };
    current.dates.add(entry.date);
    current.targets[entry.date] = [
      ...new Set(
        [...(current.targets[entry.date] || []), entry.status].filter(Boolean),
      ),
    ];
    grouped.set(entry.ticketUrl, current);
  }
  const items = [...grouped].map(([url, value]) => ({
    url,
    dates: [...value.dates],
    targets: value.targets,
  }));
  setBusy(true);
  const response = await chrome.runtime.sendMessage({
    type: "START_SCAN",
    items,
    maxDepth: Number($("#depth").value),
    githubToken,
    recorder,
    inputContext: inputContext(state.entries),
  });
  if (!response?.ok) {
    setBusy(false);
    showError(response?.error || "Tidak dapat memulai scan.");
  }
}

function updateJob(job) {
  state.job = job;
  $("#progressWrap").classList.remove("hidden");
  const percentage = job.total
    ? Math.round((job.processed / job.total) * 100)
    : 0;
  $("#progressBar").style.width = `${percentage}%`;
  $("#progressText").textContent =
    `${job.processed || 0}/${job.total || 0} item · ${job.status}`;
  if (["paused", "error"].includes(job.status)) {
    setBusy(false);
    showError(job.fatalError || "Scan terhenti; klik scan untuk lanjut.");
  }
  if (job.status === "completed") {
    setBusy(false);
    const decisions = decisionRows(
      prepareDailyEntries(state.entries),
      job.scans,
    ).map((m) => m.decision);
    const high = decisions.filter((d) => d.confidence === "HIGH").length;
    const fallback = decisions.filter((d) =>
      d.intervals?.some((i) => i.reason === "explicit_end"),
    ).length;
    const review = decisions.filter((d) => d.needsReview || !d.end).length;
    const recorder = job.recorderConnected
      ? "✓ Recorder terhubung"
      : job.recorderError
        ? `△ Recorder fallback: ${escapeHtml(job.recorderError)}`
        : "△ Recorder tidak dikonfigurasi";
    const errors = (job.errors || [])
      .slice(0, 3)
      .map(
        (item) =>
          `<br><small>• ${escapeHtml(item.url)} — ${escapeHtml(item.error)}</small>`,
      )
      .join("");
    const warnings = job.warnings?.length
      ? `<br>△ ${job.warnings.length} partial GraphQL (komentar tetap dipakai)`
      : "";
    $("#summary").innerHTML =
      `${recorder}<br>✓ ${high} hasil confidence HIGH<br>△ ${fallback} fallback komentar${warnings}<br>⚠ ${review} perlu review<br>✕ ${job.errors?.length || 0} item gagal${errors}`;
    $("#summary").classList.remove("hidden");
    renderPreview();
    refreshExportState();
  }
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function previewRows(entries, scans) {
  return decisionRows(prepareDailyEntries(entries), scans).map(
    ({ entry, decision }) => {
      return {
        assignee: displayAssignee(entry.assignee),
        date: displayDate(entry.date),
        ticket: entry.ticketTitle || entry.ticketUrl,
        url: entry.ticketUrl,
        status: displayStatus(entry.status),
        start: decision.start ? formatDateTime(decision.start) : "",
        end: decision.end ? formatDateTime(decision.end) : "",
        hours: decision.hours == null ? "" : Number(decision.hours.toFixed(2)),
        rule: [decision.rule, ...decision.flags].join(" · "),
        review: decision.needsReview || !decision.start || !decision.end,
      };
    },
  );
}

function renderPreview() {
  const card = $("#previewCard");
  const body = $("#previewTable tbody");
  body.replaceChildren();
  const rows = previewRows(state.entries, state.job?.scans || {});
  for (const row of rows) {
    const tr = document.createElement("tr");
    const values = [
      row.assignee,
      row.date,
      row.ticket,
      row.status,
      row.start,
      row.end,
      row.hours,
      row.rule,
      row.review ? "YES" : "NO",
    ];
    values.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (index === 2) {
        td.className = "ticket";
        td.title = row.url;
      }
      if (index === 8) td.className = row.review ? "review-yes" : "review-no";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  $("#previewCount").textContent = `${rows.length} row`;
  card.classList.toggle("hidden", !rows.length);
}

async function exportWorkbook() {
  if (!state.job) return showError("Hasil scan belum tersedia.");
  if (
    state.job.inputContext !== inputContext(state.entries) ||
    state.job.maxDepth !== Number($("#depth").value)
  )
    return showError(
      "Input DSM/PIC berubah. Jalankan scan untuk input ini terlebih dahulu.",
    );
  const options = { mode: $("#importMode").value };
  let result = state.workbook
    ? fillWorkbook(state.workbook, state.entries, state.job.scans, options)
    : createWorkbookFromDsm(state.entries, state.job.scans);
  if (state.workbook) {
    const approved = await reviewChanges(result.changes);
    if (approved == null) return;
    result = fillWorkbook(state.workbook, state.entries, state.job.scans, {
      ...options,
      allowedRowIds: approved,
    });
  }

  const bytes = XLSX.write(result.workbook, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
  });
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const outputName = state.kpiFileName
    ? state.kpiFileName.replace(/\.xlsx?$/i, "-GITUBGEN-V2.xlsx")
    : generatedFileName(state.entries);
  await chrome.downloads.download({ url, filename: outputName, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  showInfo(
    `${result.updated} row KPI dibuat/diisi; ${result.skipped || 0} row dilewati; ${result.review} perlu review.`,
  );
}

function selectedAssignees() {
  return [...document.querySelectorAll('[name="assignee"]:checked')].map(
    (input) => input.value,
  );
}
function setBusy(busy) {
  scanButton.disabled = busy;
  scanButton.textContent = busy ? "Scanning..." : "Mulai scan GitHub";
}
function showError(text) {
  message.style.color = "#cf222e";
  message.textContent = text;
}
function showInfo(text) {
  message.style.color = "#1a7f37";
  message.textContent = text;
}
function clearMessage() {
  message.textContent = "";
}
function refreshExportState() {
  exportButton.classList.toggle(
    "hidden",
    !(
      state.entries.length &&
      state.job?.status === "completed" &&
      state.job.inputContext === inputContext(state.entries) &&
      state.job.maxDepth === Number($("#depth").value)
    ),
  );
}
async function restoreJob() {
  const job = await chrome.runtime.sendMessage({ type: "GET_JOB" });
  if (job) updateJob(job);
}
async function resetJob() {
  const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_JOB" });
  if (!cleared?.ok) return showError(cleared?.error || "Tidak dapat reset.");
  state.job = null;
  $("#progressWrap").classList.add("hidden");
  $("#summary").classList.add("hidden");
  $("#previewCard").classList.add("hidden");
  exportButton.classList.add("hidden");
  showInfo("Checkpoint dihapus.");
}

async function reviewChanges(changes) {
  const dialog = $("#changesDialog"),
    body = $("#changesBody");
  body.replaceChildren();
  const grouped = new Map();
  for (const c of changes) grouped.set(c.id, [...(grouped.get(c.id) || []), c]);
  for (const [id, items] of grouped) {
    const tr = document.createElement("tr"),
      td = document.createElement("td"),
      check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.value = id;
    td.appendChild(check);
    tr.appendChild(td);
    for (const text of [
      items[0].row,
      items
        .map(
          (c) =>
            `${c.field}: ${c.before === "" ? "(kosong)" : c.before} → ${c.after}`,
        )
        .join("\n"),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      cell.style.whiteSpace = "pre-wrap";
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  return new Promise((resolve) => {
    dialog.onclose = () =>
      resolve(
        dialog.returnValue === "apply"
          ? [...body.querySelectorAll("input:checked")].map((i) => i.value)
          : null,
      );
    dialog.showModal();
  });
}
