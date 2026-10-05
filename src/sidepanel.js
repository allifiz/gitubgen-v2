import * as XLSX from 'xlsx';
import { parseDsm } from './lib/dsm-parser.js';
import { decideTimes } from './lib/activity-matcher.js';
import { normalizeGitHubUrl } from './lib/github-url.js';
import { normalizePerson } from './lib/person.js';

const state = { entries: [], workbook: null, kpiFileName: null, job: null };
const $ = selector => document.querySelector(selector);
const dsmFile = $('#dsmFile');
const kpiFile = $('#kpiFile');
const scanButton = $('#scan');
const exportButton = $('#export');
const message = $('#message');

dsmFile.addEventListener('change', loadDsm);
kpiFile.addEventListener('change', loadWorkbook);
scanButton.addEventListener('click', startScan);
exportButton.addEventListener('click', exportWorkbook);
$('#reset').addEventListener('click', resetJob);
chrome.runtime.onMessage.addListener(event => {
  if (event.type === 'JOB_PROGRESS') updateJob(event.job);
});

restoreJob();

async function loadDsm() {
  clearMessage();
  const file = dsmFile.files[0];
  if (!file) return;
  const selected = selectedAssignees();
  state.entries = parseDsm(await file.text(), { year: 2026, assignees: selected });
  if (!state.entries.length) showError('Tidak menemukan tiket DSM lengkap dengan tanggal, sesi, dan assignee.');
  else showInfo(`${state.entries.length} kemunculan tiket DSM ditemukan.`);
  refreshExportState();
}

async function loadWorkbook() {
  clearMessage();
  const file = kpiFile.files[0];
  if (!file) return;
  state.workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellDates: false });
  state.kpiFileName = file.name;
  showInfo(`Workbook ${file.name} siap.`);
  refreshExportState();
}

async function startScan() {
  clearMessage();
  if (!dsmFile.files[0]) return showError('Pilih file DSM terlebih dahulu.');
  await loadDsm();
  if (!state.entries.length) return;
  const grouped = new Map();
  for (const entry of state.entries) {
    const dates = grouped.get(entry.ticketUrl) || new Set();
    dates.add(entry.date);
    grouped.set(entry.ticketUrl, dates);
  }
  const items = [...grouped].map(([url, dates]) => ({ url, dates: [...dates] }));
  setBusy(true);
  const response = await chrome.runtime.sendMessage({
    type: 'START_SCAN', items, maxDepth: Number($('#depth').value)
  });
  if (!response?.ok) {
    setBusy(false);
    showError(response?.error || 'Tidak dapat memulai scan.');
  }
}

function updateJob(job) {
  state.job = job;
  $('#progressWrap').classList.remove('hidden');
  const percentage = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  $('#progressBar').style.width = `${percentage}%`;
  $('#progressText').textContent = `${job.processed || 0}/${job.total || 0} halaman · ${job.status}`;
  if (job.status === 'completed') {
    setBusy(false);
    const decisions = state.entries.map(entry => decideTimes(entry, job.scans));
    const high = decisions.filter(d => d.confidence === 'HIGH').length;
    const fallback = decisions.filter(d => d.rule === 'DSM_FALLBACK_GITHUB_END').length;
    const review = decisions.filter(d => d.needsReview || !d.end).length;
    $('#summary').innerHTML = `✓ ${high} status pair<br>△ ${fallback} fallback DSM<br>⚠ ${review} perlu review<br>✕ ${job.errors?.length || 0} halaman gagal`;
    $('#summary').classList.remove('hidden');
    refreshExportState();
  }
}

async function exportWorkbook() {
  if (!state.workbook || !state.job) return showError('Workbook atau hasil scan belum tersedia.');
  const result = fillWorkbook(state.workbook, state.entries, state.job.scans);
  const bytes = XLSX.write(result.workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const outputName = (state.kpiFileName || 'KPI-September-2026.xlsx').replace(/\.xlsx?$/i, '-GITUBGEN-V2.xlsx');
  await chrome.downloads.download({ url, filename: outputName, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  showInfo(`${result.updated} row kosong diisi; ${result.skipped} row dilewati; ${result.review} perlu review.`);
}

export function fillWorkbook(workbook, entries, scans) {
  const sheetName = workbook.SheetNames.find(name => /^kpi$/i.test(name)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headerIndex = findHeaderRow(matrix);
  if (headerIndex < 0) throw new Error('Header KPI tidak ditemukan.');
  const headers = matrix[headerIndex].map(normalizeHeader);
  const cols = {
    assignee: findColumn(headers, ['assignee', 'pic']),
    url: findColumn(headers, ['ticket url', 'url']),
    date: findColumn(headers, ['date', 'tanggal']),
    start: findColumn(headers, ['start time', 'start']),
    end: findColumn(headers, ['end time', 'end']),
    hour: findColumn(headers, ['hour', 'hours', 'durasi'])
  };
  if ([cols.url, cols.date, cols.start, cols.end].some(index => index < 0)) throw new Error('Kolom Ticket URL, Date, Start Time, atau End Time tidak ditemukan.');

  const diagnostic = [['KPI Row','Assignee','Date','Session','Ticket URL','Start Time','End Time','Hour','Rule','Start Source','End Source','Confidence','Needs Review']];
  let updated = 0, skipped = 0, review = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex];
    const url = normalizeGitHubUrl(String(row[cols.url] || ''));
    if (!url) continue;
    if (row[cols.start] || row[cols.end]) { skipped += 1; continue; }
    const date = normalizeDate(row[cols.date]);
    const assignee = normalizePerson(row[cols.assignee]);
    const candidates = entries.filter(entry => entry.ticketUrl === url && entry.date === date && (!assignee || normalizePerson(entry.assignee) === assignee));
    const entry = candidates[0];
    if (!entry) { review += 1; continue; }
    const decision = decideTimes(entry, scans);
    if (!decision.start || !decision.end || decision.needsReview) review += 1;
    if (decision.start) setCell(sheet, rowIndex, cols.start, formatDateTime(decision.start));
    if (decision.end) setCell(sheet, rowIndex, cols.end, formatDateTime(decision.end));
    if (decision.hours != null && cols.hour >= 0) setCell(sheet, rowIndex, cols.hour, Number(decision.hours.toFixed(2)), 'n');
    updated += decision.start || decision.end ? 1 : 0;
    diagnostic.push([
      rowIndex + 1, entry.assignee, entry.date, entry.session, entry.ticketUrl,
      decision.start ? formatDateTime(decision.start) : '', decision.end ? formatDateTime(decision.end) : '',
      decision.hours == null ? '' : Number(decision.hours.toFixed(2)), decision.rule,
      decision.startSource || '', decision.endSource || '', decision.confidence, decision.needsReview ? 'YES' : 'NO'
    ]);
  }

  const diagnosticSheet = XLSX.utils.aoa_to_sheet(diagnostic);
  diagnosticSheet['!cols'] = [8,16,12,10,55,20,20,10,30,50,50,12,14].map(wch => ({ wch }));
  if (workbook.SheetNames.includes('Diagnostic')) delete workbook.Sheets.Diagnostic;
  else workbook.SheetNames.push('Diagnostic');
  workbook.Sheets.Diagnostic = diagnosticSheet;
  return { workbook, updated, skipped, review };
}

function findHeaderRow(matrix) {
  return matrix.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes('ticket url') && normalized.some(cell => cell === 'start time');
  });
}
function findColumn(headers, names) { return headers.findIndex(header => names.includes(header)); }
function normalizeHeader(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function normalizeDate(value) {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
  }
  const text = String(value || '').trim();
  const parts = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (parts) return `${parts[3]}-${parts[2].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  return text.slice(0, 10);
}
function formatDateTime(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).formatToParts(new Date(iso)).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function setCell(sheet, zeroRow, zeroCol, value, type = 's') {
  const address = XLSX.utils.encode_cell({ r: zeroRow, c: zeroCol });
  const previous = sheet[address] || {};
  sheet[address] = { ...previous, v: value, t: type };
}
function selectedAssignees() { return [...document.querySelectorAll('[name="assignee"]:checked')].map(input => input.value); }
function setBusy(busy) { scanButton.disabled = busy; scanButton.textContent = busy ? 'Scanning...' : 'Mulai scan GitHub'; }
function showError(text) { message.style.color = '#cf222e'; message.textContent = text; }
function showInfo(text) { message.style.color = '#1a7f37'; message.textContent = text; }
function clearMessage() { message.textContent = ''; }
function refreshExportState() {
  exportButton.classList.toggle('hidden', !(state.workbook && state.entries.length && state.job?.status === 'completed'));
}
async function restoreJob() { const job = await chrome.runtime.sendMessage({ type: 'GET_JOB' }); if (job) updateJob(job); }
async function resetJob() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_JOB' });
  state.job = null;
  $('#progressWrap').classList.add('hidden'); $('#summary').classList.add('hidden'); exportButton.classList.add('hidden');
  showInfo('Checkpoint dihapus.');
}
