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
