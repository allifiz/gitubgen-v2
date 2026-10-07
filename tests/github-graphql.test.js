import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatusHistory, parseIssueUrl } from '../src/lib/github-graphql.js';

test('URL GitHub issue diubah menjadi variabel GraphQL', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/GO-Bimbel/db-sekolah/issues/1272'), {
    owner: 'GO-Bimbel', repo: 'db-sekolah', kind: 'issues', number: 1272
  });
});

test('event GraphQL dinormalisasi agar kompatibel dengan activity matcher', () => {
  const url = 'https://github.com/GO-Bimbel/db-sekolah/issues/1272';
  const events = normalizeStatusHistory({ data: { repository: { issue: { timelineItems: { nodes: [{
    createdAt: '2026-09-23T03:42:49Z', previousStatus: 'Todo', status: 'In Progress',
    wasAutomated: false, actor: { login: 'dwikyananditya' }, project: { number: 11, title: 'BE-TASK' }
  }] } } } } }, url);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'status');
  assert.equal(events[0].source, 'graphql');
  assert.match(events[0].text, /Todo to In Progress/);
});

test('GraphQL tanpa status history menghasilkan array kosong', () => {
  const events = normalizeStatusHistory({ data: { repository: { issue: { timelineItems: { nodes: [] } } } } }, 'https://github.com/a/b/issues/1');
  assert.deepEqual(events, []);
});
