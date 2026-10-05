import test from 'node:test';
import assert from 'node:assert/strict';
import { systemType, ticketType, weekOfMonth } from '../src/lib/kpi-fields.js';

test('metadata KPI diturunkan dari judul dan tanggal DSM', () => {
  const title='[SUPERAPPS-APPS] FIX: Resume Presensi Siswa';
  assert.equal(systemType(title),'SUPERAPPS');
  assert.equal(ticketType(title),'FIX');
  assert.equal(weekOfMonth('2026-09-17'),'Minggu 3');
  assert.equal(weekOfMonth('2026-09-28'),'Minggu 5');
});
