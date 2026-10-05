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
