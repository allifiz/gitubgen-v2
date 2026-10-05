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

function collectEvents() {
  const times = [...document.querySelectorAll('relative-time[datetime], time[datetime]')];
  const seen = new Set();
  return times.map(time => {
    const container = time.closest('.TimelineItem, [data-testid="timeline-item"], .js-timeline-item') || time.parentElement;
    const text = (container?.innerText || time.parentElement?.innerText || '').replace(/\s+/g, ' ').trim();
    const datetime = time.getAttribute('datetime');
    const key = `${datetime}|${text}`;
    if (!datetime || seen.has(key)) return null;
    seen.add(key);
    return { datetime, text, type: classify(text) };
  }).filter(Boolean);
}

function classify(text) {
  if (/in progress|ready to review|status/i.test(text)) return 'status';
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
    const title = document.querySelector('[data-testid="issue-title"], .js-issue-title')?.textContent?.trim() || document.title;
    sendResponse({
      ok: true,
      url: location.href.split(/[?#]/)[0],
      title,
      events: collectEvents(),
      linkedUrls: linkedUrls(),
      collectedAt: new Date().toISOString()
    });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
