import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRecorderHistory, transitionToEvent } from '../src/lib/recorder-api.js';

test('status transition recorder menjadi event yang dipahami matcher', () => {
  const event = transitionToEvent({
    issueUrl: 'https://github.com/GO-Bimbel/api/issues/3908',
    previousStatus: 'In Progress', newStatus: 'Ready to Review',
    occurredAt: '2026-10-14T02:01:42Z', detectedAt: '2026-10-14T02:02:00Z', source: 'poll'
  });
  assert.equal(event.type, 'status');
  assert.match(event.text, /from In Progress to Ready to Review/);
  assert.equal(event.source, 'recorder');
});

test('client mengirim batch URL dan bearer secret', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true, history: [{
      issueUrl: 'https://github.com/o/r/issues/1', previousStatus: 'Todo', newStatus: 'In Progress',
      occurredAt: '2026-10-14T01:00:00Z', detectedAt: '2026-10-14T01:01:00Z', source: 'poll'
    }] }) };
  };
  const result = await fetchRecorderHistory(
    { url: 'https://recorder.vercel.app/', secret: 'secret' },
    ['https://github.com/o/r/issues/1'], { from: '2026-10-14T00:00:00+07:00' }, fetchImpl
  );
  assert.equal(request.url, 'https://recorder.vercel.app/api/status-history');
  assert.equal(request.options.headers.authorization, 'Bearer secret');
  assert.equal(result['https://github.com/o/r/issues/1'][0].source, 'recorder');
});
