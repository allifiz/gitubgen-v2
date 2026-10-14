function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Recorder URL wajib menggunakan HTTPS.');
  }
  return url.toString().replace(/\/$/, '');
}

export function transitionToEvent(transition) {
  const from = transition.previousStatus ? ` from ${transition.previousStatus}` : '';
  return {
    type: 'status',
    datetime: transition.occurredAt,
    text: `GitubGen Recorder moved this${from} to ${transition.newStatus}`,
    url: transition.issueUrl,
    source: 'recorder',
    recorderSource: transition.source,
    detectedAt: transition.detectedAt
  };
}

export async function fetchRecorderHistory(config, issueUrls, range = {}, fetchImpl = fetch) {
  const baseUrl = normalizeBaseUrl(config?.url);
  if (!config?.secret) throw new Error('Recorder API secret wajib diisi.');
  const response = await fetchImpl(`${baseUrl}/api/status-history`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.secret}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ issueUrls: [...new Set(issueUrls)], ...range })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Recorder HTTP ${response.status}`);

  const byUrl = {};
  for (const transition of data.history || []) {
    (byUrl[transition.issueUrl] ||= []).push(transitionToEvent(transition));
  }
  return byUrl;
}
