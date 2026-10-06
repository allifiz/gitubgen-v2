const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function revealTimeline() {
  for (let round = 0; round < 8; round += 1) {
    const buttons = [...document.querySelectorAll('button, summary')].filter(element =>
      /load more|show more|show hidden|older activity/i.test(element.textContent || '')
    );
    if (!buttons.length) break;
    buttons.forEach(button => button.click());
    await wait(500);
  }
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  await wait(500);
}

async function revealProjectFields() {
  const buttons = [...document.querySelectorAll('button, summary')].filter(element =>
    /show more project fields/i.test(element.textContent || element.getAttribute('aria-label') || '')
  );
  buttons.forEach(button => button.click());
  if (buttons.length) await wait(400);
}

function normalizeProjectDate(value = '') {
  const text = String(value).replace(/\s+/g, ' ').trim();
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const named = text.match(/\b(?:target date\s*)?([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (named) {
    const month = months[named[1].slice(0,3).toLowerCase()];
    if (month) return `${named[3]}-${String(month).padStart(2,'0')}-${named[2].padStart(2,'0')}`;
  }
  return '';
}

function collectTargetDate() {
  const candidates = [...document.querySelectorAll('body *')].filter(element =>
    /^target date$/i.test((element.textContent || '').replace(/\s+/g, ' ').trim())
  );
  for (const label of candidates) {
    let node = label.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length > 200) break;
      const date = normalizeProjectDate(text.replace(/target date/i, ''));
      if (date) return date;
      const time = node.querySelector('time[datetime], relative-time[datetime]');
      const datetime = time?.getAttribute('datetime');
      if (datetime) return datetime.slice(0,10);
    }
  }
  return '';
}

function collectEvents() {
  const times = [...document.querySelectorAll('relative-time[datetime], time[datetime]')];
  const seen = new Set();
  return times.map(time => {
    const container = findEventContainer(time);
    const text = (container?.innerText || time.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
    const datetime = time.getAttribute('datetime');
    const key = `${datetime}|${text}`;
    if (!datetime || seen.has(key)) return null;
    seen.add(key);
    return { datetime, text, type: classify(text) };
  }).filter(Boolean);
}

function findEventContainer(time) {
  const known = time.closest('.TimelineItem, [data-testid="timeline-item"], .js-timeline-item');
  if (known) return known;
  const signal = /(moved this|changed (?:the )?status|linked a pull request|merged|commit|closed this|reopened this|commented|opened|assigned|mentioned this|added (?:this|a parent|sub-issues?))/i;
  let node = time.parentElement;
  let best = node;
  for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
    const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
    if (text.length > 0 && text.length < 1000) best = node;
    if (signal.test(text) && text.length < 1000) return node;
  }
  return best;
}

function classify(text) {
  if (/todo|in progress|ready to review|staging|deployed|status/i.test(text)) return 'status';
  if (/pull request|merged|review/i.test(text)) return 'pull_request';
  if (/commit/i.test(text)) return 'commit';
  if (/closed|reopened/i.test(text)) return 'issue_state';
  return 'activity';
}

function linkedUrls() {
  return [...document.querySelectorAll('a[href*="/issues/"], a[href*="/pull/"]')]
    .map(anchor => {
      try {
        const url = new URL(anchor.href);
        const match = url.pathname.match(/^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/);
        return match ? `${url.origin}${match[0]}` : null;
      } catch { return null; }
    })
    .filter((url, index, all) => url && url !== location.href.split(/[?#]/)[0] && all.indexOf(url) === index)
    .slice(0, 30);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'COLLECT_GITHUB_TIMELINE') return undefined;
  (async () => {
    await revealTimeline();
    await revealProjectFields();
    const title = document.querySelector('[data-testid="issue-title"], .js-issue-title')?.textContent?.trim() || document.title;
    sendResponse({
      ok: true,
      url: location.href.split(/[?#]/)[0],
      title,
      events: collectEvents(),
      linkedUrls: linkedUrls(),
      targetDate: collectTargetDate(),
      collectedAt: new Date().toISOString()
    });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
