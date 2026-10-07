const STORAGE_KEY = 'gitubgenJob';
let running = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_SCAN') {
    if (running) {
      sendResponse({ ok: false, error: 'Scan masih berjalan.' });
      return undefined;
    }
    startScan(message.items, message.maxDepth ?? 1).catch(() => {});
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'GET_JOB') {
    chrome.storage.local.get(STORAGE_KEY).then(data => sendResponse(data[STORAGE_KEY] || null));
    return true;
  }
  if (message.type === 'CLEAR_JOB') {
    chrome.storage.local.remove(STORAGE_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});

async function startScan(inputItems, maxDepth) {
  if (running) throw new Error('Scan masih berjalan.');
  running = true;
  try {
    const previous = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    const job = previous?.status === 'paused'
      ? previous
      : {
          status: 'running',
          queue: mergeInputItems(inputItems).map(item => ({ ...item, depth: 0 })),
          scans: {}, errors: [], processed: 0, total: mergeInputItems(inputItems).length,
          startedAt: new Date().toISOString(), maxDepth
        };
    job.status = 'running';

    while (job.queue.length) {
      const item = job.queue.shift();
      if (job.scans[item.url]) continue;
      try {
        const scan = await scanUrl(item.url);
        job.scans[item.url] = scan;
        if (item.depth < maxDepth && needsRelatedScan(scan, item.targets)) {
          for (const linkedUrl of scan.linkedUrls || []) {
            if (!job.scans[linkedUrl] && !job.queue.some(q => q.url === linkedUrl)) {
              job.queue.push({ url: linkedUrl, dates: item.dates, targets: item.targets, depth: item.depth + 1 });
              job.total += 1;
            }
          }
        }
      } catch (error) {
        job.errors.push({ url: item.url, error: error.message });
      }
      job.processed += 1;
      await saveAndNotify(job);
    }
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    await saveAndNotify(job);
  } catch (error) {
    const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    data.status = 'paused';
    data.fatalError = error.message;
    await saveAndNotify(data);
    throw error;
  } finally {
    running = false;
  }
}

function mergeInputItems(items = []) {
  const byUrl = new Map();
  for (const item of items) {
    const current = byUrl.get(item.url) || { dates: new Set(), targets: {} };
    for (const date of item.dates || []) current.dates.add(date);
    for (const [date, statuses] of Object.entries(item.targets || {})) {
      current.targets[date] = [...new Set([...(current.targets[date] || []), ...statuses])];
    }
    byUrl.set(item.url, current);
  }
  return [...byUrl].map(([url, value]) => ({ url, dates: [...value.dates], targets: value.targets }));
}

function needsRelatedScan(scan, targets = {}) {
  return Object.entries(targets).some(([date, statuses]) => {
    const events = (scan.events || []).filter(event => jakartaDate(event.datetime) === date);
    const hasEnd = statuses.some(status => hasValidEnd(events, status));
    // Related issue/sub-issue hanya dibutuhkan untuk mencari bukti End.
    // Start wajib berasal dari transisi In Progress pada parent issue.
    return !hasEnd;
  });
}

function hasValidEnd(events, status = '') {
  const normalized = String(status).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (events.some(event => new RegExp(`to\\s+${normalized.replace(/ /g, '\\s+')}\\b`, 'i').test(event.text) && /(status|moved|changed)/i.test(event.text))) return true;
  if (normalized === 'deployed' && events.some(event => /closed this|closed as completed/i.test(event.text))) return true;
  if (normalized === 'staging' && events.some(event => /merged(?: commit| .* into) staging/i.test(event.text))) return true;
  return events.some(event => /(linked a pull request|merged|commit(?:ted)?|closed this)/i.test(event.text));
}

function jakartaDate(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso));
}

async function scanUrl(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_GITHUB_TIMELINE' });
        if (response?.ok) return response;
        throw new Error(response?.error || 'Timeline tidak terbaca.');
      } catch (error) {
        if (attempt === 2) throw error;
        await delay(1000);
      }
    }
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
  throw new Error('Scan gagal.');
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timeout membuka halaman GitHub.'));
    }, 30_000);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function saveAndNotify(job) {
  await chrome.storage.local.set({ [STORAGE_KEY]: job });
  chrome.runtime.sendMessage({ type: 'JOB_PROGRESS', job }).catch(() => {});
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
