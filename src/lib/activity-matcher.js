import { fallbackStart } from './dsm-parser.js';

function localDate(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso));
}

function isStatusTo(event, status) {
  const text = `${event.type || ''} ${event.text || ''}`.toLowerCase();
  const wanted = status.toLowerCase();
  return text.includes(wanted) && /(status|moved|changed|converted)/.test(text);
}

function relevantEvents(scan, date) {
  return (scan?.events || [])
    .filter(event => event.datetime && localDate(event.datetime) === date)
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

export function decideTimes(entry, scansByUrl) {
  const parent = scansByUrl[entry.ticketUrl];
  const parentEvents = relevantEvents(parent, entry.date);
  const starts = parentEvents.filter(event => isStatusTo(event, 'in progress'));
  const ends = parentEvents.filter(event => isStatusTo(event, 'ready to review'));

  for (const start of starts) {
    const end = ends.find(candidate => new Date(candidate.datetime) > new Date(start.datetime));
    if (end) {
      return decision(start.datetime, end.datetime, 'PARENT_STATUS_PAIR', parent.url, parent.url, 'HIGH');
    }
  }

  const linkedUrls = parent?.linkedUrls || [];
  const linkedEvents = linkedUrls.flatMap(url =>
    relevantEvents(scansByUrl[url], entry.date).map(event => ({ ...event, sourceUrl: url }))
  ).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  const allEndCandidates = [...parentEvents.map(e => ({ ...e, sourceUrl: parent?.url })), ...linkedEvents]
    .filter(event => /(ready to review|review|pull request|merged|closed|commit|staging)/i.test(`${event.type} ${event.text}`));
  const end = allEndCandidates.at(-1);

  if (!end) {
    return {
      start: null, end: null, hours: null, rule: 'NEEDS_REVIEW_NO_END',
      startSource: null, endSource: null, confidence: 'LOW', needsReview: true
    };
  }

  const sameDayStart = starts.filter(event => new Date(event.datetime) < new Date(end.datetime)).at(-1);
  const start = sameDayStart?.datetime || fallbackStart(entry.date, entry.session);
  return decision(
    start,
    end.datetime,
    sameDayStart ? 'PARENT_START_ACTIVITY_END' : 'DSM_FALLBACK_GITHUB_END',
    sameDayStart ? parent?.url : `DSM ${entry.session}`,
    end.sourceUrl,
    sameDayStart ? 'MEDIUM' : 'LOW'
  );
}

function decision(start, end, rule, startSource, endSource, confidence) {
  const hours = Math.max(0, (new Date(end) - new Date(start)) / 3_600_000);
  return { start, end, hours, rule, startSource, endSource, confidence, needsReview: hours <= 0 };
}
