import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import { createWorkbookFromDsm, fillWorkbook } from '../src/lib/workbook.js';

const url = 'https://github.com/GO-Bimbel/db-go/issues/100';
const other = 'https://github.com/GO-Bimbel/db-go/issues/101';
const task = (assignee, date, ticketUrl = url) => ({
  assignee, date, session: '11:00', sessions: ['11:00'],
  ticketUrl, ticketTitle: 'Task', status: 'In Progress',
});
const status = (datetime, status, projectNumber = 11) => ({
  type: 'status', datetime, status, projectNumber,
});
const scans = {
  [url]: {
    title: 'Task from GitHub', startDate: '2026-09-29',
    targetDate: '2026-10-02', currentProjectStatus: 'Deployed',
    closedAt: '2026-10-06T09:00:00Z',
    events: [
      status('2026-10-01T17:30:00Z', 'Staging', 99),
      status('2026-10-02T18:00:00Z', 'Staging'), // 03 Oct WIB: late
      status('2026-10-06T08:00:00Z', 'Deployed'),
    ], linkedUrls: [],
  },
  [other]: {
    title: 'Other task', currentProjectStatus: 'Ready to Review',
    events: [status('2026-10-03T08:00:00Z', 'Ready to Review')],
    linkedUrls: [],
  },
};

test('generate langsung dari DSM dan scan Project tanpa TSV: rekap unik dan resume per PIC', () => {
  const entries = [task('allief', '2026-09-30'), task('allief', '2026-10-03'),
    task('hizkia', '2026-10-03', other)];
  const { workbook } = createWorkbookFromDsm(entries, scans);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['Rekap Tiket Unik'], { defval: '' });
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Resume);
  assert.equal(detail.length, 2);
  assert.equal(detail[0]['Date DSM'], '30/09/2026');
  assert.equal(detail[0]['Start Date'], '29/09/2026');
  assert.equal(detail[0]['Target Date'], '02/10/2026');
  assert.equal(detail[0]['End Date'], '03/10/2026');
  assert.equal(detail[0].Ketepatan, 'Melewati Target');
  assert.equal(detail[0]['Tiket Closed'], 'Ya');
  assert.equal(detail[1].Ketepatan, 'Tanpa Target');
  assert.deepEqual(summary.map(({ 'Nama PIC': pic, 'Total Task': total,
    'Done / Closed': done, Staging: staging, 'Ready to Review': review,
    'Tepat Waktu': onTime, 'Melewati Target': late, 'Tanpa Target': noTarget }) =>
    [pic, total, done, staging, review, onTime, late, noTarget]), [
    ['Allief', 1, 1, 0, 0, 0, 1, 0],
    ['Hizkia', 1, 0, 0, 1, 0, 0, 1],
  ]);
});

test('impor KPI menjumlah semua baris tiket, menjaga jam kosong dan total jam nol', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Assignee', 'Ticket Title', 'URL', 'Date', 'Start', 'End', 'Hour'],
    ['Allief', 'Task', url, '30/09/2026', '', '', 1.25],
    ['Allief', 'Task', url, '01/10/2026', '', '', ''],
    ['Allief', 'Task', url, '03/10/2026', '', '', 2.5],
    ['Hizkia', 'Other task', other, '03/10/2026', '', '', 0],
  ]), 'KPI');
  const { workbook } = fillWorkbook(wb, [task('allief', '2026-09-30'),
    task('allief', '2026-10-03'), task('hizkia', '2026-10-03', other)], scans);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['Rekap Tiket Unik'], { defval: '' });
  assert.equal(detail[0]['Total Hour'], 3.75);
  assert.equal(detail[0]['Cakupan Hour'], '2/3 baris KPI');
  assert.equal(detail[1]['Total Hour'], 0);
  assert.equal(detail[1]['Cakupan Hour'], '1/1 baris KPI');
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Resume)[0]['Total Task'], 1);
});
