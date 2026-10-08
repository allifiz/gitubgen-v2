import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivity, normalizeStatusHistory, parseIssueUrl } from '../src/lib/github-graphql.js';

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

test('GraphQL menormalisasi sub-issue, PR, comment, commit, review, merge, dan Target Date', () => {
  const issueUrl = 'https://github.com/GO-Bimbel/api/issues/10';
  const pullUrl = 'https://github.com/GO-Bimbel/api/pull/11';
  const payload = { data: { repository: { issue: {
    title: 'Parent', url: issueUrl,
    comments: { nodes: [{ createdAt: '2026-09-08T03:00:00Z', author: { login: 'allif' } }] },
    trackedIssues: { nodes: [{ url: 'https://github.com/GO-Bimbel/api/issues/12' }] },
    projectItems: { nodes: [{ fieldValues: { nodes: [{ date: '2026-09-09', field: { name: 'Target Date' } }] } }] },
    timelineItems: { nodes: [{
      __typename: 'CrossReferencedEvent', createdAt: '2026-09-08T04:00:00Z', actor: { login: 'allif' },
      source: { url: pullUrl, title: 'Implementation' }
    }] }
  } } } };
  const scan = normalizeActivity(payload, issueUrl);
  assert.equal(scan.activitySource, 'graphql');
  assert.equal(scan.targetDate, '2026-09-09');
  assert.deepEqual(scan.linkedUrls, ['https://github.com/GO-Bimbel/api/issues/12', pullUrl]);
  assert.ok(scan.events.some(event => event.type === 'comment'));
  assert.ok(scan.events.some(event => event.type === 'pull_request'));
});

test('GraphQL PR menghasilkan aktivitas kerja lengkap untuk End Time', () => {
  const url = 'https://github.com/GO-Bimbel/api/pull/11';
  const payload = { data: { repository: { pullRequest: {
    title: 'Implementation', url, createdAt: '2026-09-08T02:00:00Z', mergedAt: '2026-09-08T08:00:00Z',
    author: { login: 'allif' }, mergedBy: { login: 'reviewer' },
    comments: { nodes: [{ createdAt: '2026-09-08T05:00:00Z', author: { login: 'reviewer' } }] },
    reviews: { nodes: [{ submittedAt: '2026-09-08T06:00:00Z', state: 'APPROVED', author: { login: 'reviewer' } }] },
    commits: { nodes: [{ commit: { committedDate: '2026-09-08T04:00:00Z', messageHeadline: 'fix', author: { user: { login: 'allif' } } } }] },
    projectItems: { nodes: [] }, timelineItems: { nodes: [] }
  } } } };
  const scan = normalizeActivity(payload, url);
  assert.deepEqual(scan.events.map(event => event.type), ['pull_request', 'commit', 'comment', 'review', 'pull_request']);
  assert.match(scan.events.at(-1).text, /merged pull request/);
});
