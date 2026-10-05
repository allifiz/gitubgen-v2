import { normalizeGitHubUrl } from './github-url.js';

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  januari: 0, februari: 1, maret: 2, mei: 4, juni: 5, juli: 6,
  agustus: 7, oktober: 9, desember: 11
};

const ALIASES = {
  allief: ['allief', 'allif', 'allifgobimbel'],
  hizkia: ['hizkia', 'hizkiagobimbel'],
  maulana: ['maulana', 'maulanagobimbel'],
  dwiki: ['dwiki', 'dwiky', 'dwikigobimbel', 'dwikygobimbel']
};

function pad(value) { return String(value).padStart(2, '0'); }

export function parseDateFromText(text, yearHint = new Date().getFullYear()) {
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (numeric) return `${numeric[3]}-${pad(numeric[2])}-${pad(numeric[1])}`;

  const named = text.toLowerCase().match(/\b(\d{1,2})\s+([a-z]+)\s*(\d{4})?\b/);
  if (named && MONTHS[named[2]] !== undefined) {
    return `${named[3] || yearHint}-${pad(MONTHS[named[2]] + 1)}-${pad(named[1])}`;
  }
  return null;
}

export function parseSessionFromText(text) {
  const explicit = text.match(/\b(?:pukul|jam|dsm|sesi)?\s*(11|15|16)(?:[:.]([0-5]\d))?\b/i);
  if (!explicit) return null;
  return `${explicit[1].padStart(2, '0')}:${explicit[2] || '00'}`;
}

function findAssignees(text) {
  const lower = text.toLowerCase();
  return Object.entries(ALIASES)
    .filter(([, aliases]) => aliases.some(alias => new RegExp(`\\b${alias}\\b`, 'i').test(lower)))
    .map(([name]) => name);
}

export function parseDsm(markdown, options = {}) {
  const yearHint = options.year || 2026;
  const selected = new Set((options.assignees || Object.keys(ALIASES)).map(v => v.toLowerCase()));
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let currentDate = null;
  let currentSession = null;
  let currentAssignees = [];
  let currentTitle = '';
  let currentEntryIndexes = [];

  lines.forEach((line, lineIndex) => {
    currentDate = parseDateFromText(line, yearHint) || currentDate;
    currentSession = parseSessionFromText(line) || currentSession;
    const lineAssignees = findAssignees(line);
    if (lineAssignees.length) currentAssignees = lineAssignees;

    const titleMatch = line.match(/(?:#{1,6}\s*)?(?:\*{1,2})?Task\s+\d+\s*\|\s*(.+?)(?:\*{1,2})?\s*$/i);
    if (titleMatch) {
      currentTitle = cleanMarkdown(titleMatch[1]);
      currentEntryIndexes = [];
    }

    const statusMatch = cleanMarkdown(line).match(/^Status\s*:\s*(.+)$/i);
    if (statusMatch) {
      const status = statusMatch[1].trim();
      for (const index of currentEntryIndexes) entries[index].status = status;
    }

    const normalizedLine = line.replace(/https\\:\/\//gi, 'https://');
    const urls = [...normalizedLine.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/gi)]
      .map(match => normalizeGitHubUrl(match[0]))
      .filter(Boolean);

    for (const ticketUrl of new Set(urls)) {
      const assignees = lineAssignees.length ? lineAssignees : currentAssignees;
      for (const assignee of assignees.filter(name => selected.has(name))) {
        const entry = {
          assignee,
          date: currentDate,
          session: currentSession,
          ticketUrl,
          ticketTitle: currentTitle,
          status: '',
          line: lineIndex + 1,
          raw: line.trim()
        };
        entries.push(entry);
        currentEntryIndexes.push(entries.length - 1);
      }
    }
  });

  return entries.filter(entry => entry.date && entry.session);
}

function cleanMarkdown(value = '') {
  return String(value)
    .replace(/\\([_\[\]*:#-])/g, '$1')
    .replace(/^\s*[-*]+\s*/, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sessionMinutes(session) {
  const match = String(session || '').match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

export function collapseDailyEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.assignee}|${entry.ticketUrl}|${entry.date}`;
    const current = grouped.get(key) || [];
    current.push(entry);
    grouped.set(key, current);
  }

  return [...grouped.values()].map(group => {
    const ordered = [...group].sort((a, b) => sessionMinutes(a.session) - sessionMinutes(b.session));
    const latestWithStatus = [...ordered].reverse().find(entry => entry.status);
    const latestWithTitle = [...ordered].reverse().find(entry => entry.ticketTitle);
    return {
      ...ordered[0],
      ticketTitle: latestWithTitle?.ticketTitle || ordered[0].ticketTitle || '',
      status: latestWithStatus?.status || '',
      sessions: ordered.map(entry => entry.session).filter(Boolean),
      occurrences: ordered.length,
      firstSession: ordered[0].session,
      lastSession: ordered.at(-1).session
    };
  }).sort((a, b) => `${a.date}|${a.assignee}|${a.ticketUrl}`.localeCompare(`${b.date}|${b.assignee}|${b.ticketUrl}`));
}

export function fallbackStart(date, session) {
  const hour = session?.startsWith('11') ? '09:00:00' : '13:00:00';
  return `${date}T${hour}+07:00`;
}
