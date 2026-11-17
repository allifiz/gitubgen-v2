import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDsm, collapseDailyEntries } from '../src/lib/dsm-parser.js';

test('mem-parsing tanggal, sesi, assignee, dan URL tiket', () => {
  const input = `## 8 September 2026 - DSM 11:00\n### Hizkia\n- Kerjakan https://github.com/GO-Bimbel/service/issues/123`;
  const result = parseDsm(input, { assignees: ['hizkia'], year: 2026 })[0];
  assert.equal(result.assignee, 'hizkia');
  assert.equal(result.date, '2026-09-08');
  assert.equal(result.session, '11:00');
  assert.equal(result.ticketUrl, 'https://github.com/GO-Bimbel/service/issues/123');
});

test('dua sesi tiket yang sama pada tanggal sama menjadi satu row harian', () => {
  const input = `**17 September 2026 Pukul 11.00**
**Dwiky**
## **Task 1 | \\[SUPERAPPS-APPS\\] FIX: Resume Presensi**
* **GitHub** : https\\://github.com/GO-Bimbel/db-kbm/issues/4652
* **Status** : In Progress

**17 September 2026 Pukul 16.00**
**Dwiky**
## **Task 1 | \\[SUPERAPPS-APPS\\] FIX: Resume Presensi**
* **GitHub** : https\\://github.com/GO-Bimbel/db-kbm/issues/4652
* **Status** : Staging`;
  const daily = collapseDailyEntries(parseDsm(input, { assignees:['dwiki'], year:2026 }));
  assert.equal(daily.length, 1);
  assert.deepEqual(daily[0].sessions, ['11:00','16:00']);
  assert.equal(daily[0].occurrences, 2);
  assert.equal(daily[0].status, 'Staging');
  assert.equal(daily[0].ticketTitle, '[SUPERAPPS-APPS] FIX: Resume Presensi');
});

test('mengenali ejaan Dwiky dan URL Markdown yang di-escape', () => {
  const input = `**DAILY STANDUP MEETING (DSM)**  
**18 September 2026 Pukul 16.00**

**Dwiky**

## **Task 1 | [GOEXPERT-SISWA] FIX: Error Message**

* **GitHub** : https\\://github.com/GO-Bimbel/go-expert-api/issues/677`;
  const entries = parseDsm(input, { assignees: ['dwiki'], year: 2026 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].assignee, 'dwiki');
  assert.equal(entries[0].date, '2026-09-18');
  assert.equal(entries[0].session, '16:00');
  assert.equal(entries[0].ticketUrl, 'https://github.com/GO-Bimbel/go-expert-api/issues/677');
});


test('header PIC dengan jumlah task dan separator Markdown ter-escape', () => {
  const people = [
    ['Allif ( 1 TASK)', 'allief'],
    ['Hizkia (2 TASKS)', 'hizkia'],
    ['Maulana ( 1 task )', 'maulana'],
    ['Dwiky (1 TASK)', 'dwiki'],
  ];
  const input = [
    '**DAILY STANDUP MEETING (DSM)**',
    '**16 November 2026 Pukul 16.00**',
    ...people.flatMap(([header], i) => [
      '',
      '**' + header + '**',
      '',
      '## **Task 1 \\| \\[TEST\\] FEAT: Example ' + i + '**',
      '* **GitHub** : https\\://github.com/example/service/issues/' + (i + 1),
      '* **Status** : In Progress',
    ]),
  ].join('\n');
  const rows = parseDsm(input);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.assignee), people.map(([, pic]) => pic));
  rows.forEach((row, i) => {
    assert.equal(row.date, '2026-11-16');
    assert.equal(row.session, '16:00');
    assert.equal(row.ticketTitle, '[TEST] FEAT: Example ' + i);
    assert.equal(row.ticketUrl, 'https://github.com/example/service/issues/' + (i + 1));
    assert.equal(row.status, 'In Progress');
  });
  assert.deepEqual(parseDsm(input, { assignees: ['dwiki'] }).map(row => row.assignee), ['dwiki']);
});

test('format PIC lama dan baru dapat dicampur dalam dua sesi', () => {
  const input = [
    '**16 November 2026 Pukul 11.00**',
    '**Allief**',
    '## Task 1 | Example',
    '* GitHub : https://github.com/example/service/issues/1',
    '* Status : In Progress',
    '**16 November 2026 Pukul 16.00**',
    '**Allif (1 TASK)**',
    '## Task 1 | Example',
    '* GitHub : https://github.com/example/service/issues/1',
    '* Status : Ready to Review',
    '**Maulana (0 TASK)**',
  ].join('\n');
  const rows = collapseDailyEntries(parseDsm(input));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assignee, 'allief');
  assert.deepEqual(rows[0].sessions, ['11:00', '16:00']);
  assert.equal(rows[0].status, 'Ready to Review');
});
