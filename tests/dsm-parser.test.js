import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDsm, fallbackStart } from '../src/lib/dsm-parser.js';

test('mem-parsing tanggal, sesi, assignee, dan URL tiket', () => {
  const input = `## 8 September 2026 - DSM 11:00\n### Hizkia\n- Kerjakan https://github.com/GO-Bimbel/service/issues/123`;
  assert.deepEqual(parseDsm(input, { assignees: ['hizkia'], year: 2026 })[0], {
    assignee:'hizkia', date:'2026-09-08', session:'11:00',
    ticketUrl:'https://github.com/GO-Bimbel/service/issues/123', line:3,
    raw:'- Kerjakan https://github.com/GO-Bimbel/service/issues/123'
  });
});

test('fallback mengikuti sesi DSM', () => {
  assert.match(fallbackStart('2026-09-08','11:00'), /09:00:00/);
  assert.match(fallbackStart('2026-09-08','16:00'), /13:00:00/);
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
