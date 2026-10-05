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
  dwiki: ['dwiki', 'dwikigobimbel']
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

  lines.forEach((line, lineIndex) => {
    currentDate = parseDateFromText(line, yearHint) || currentDate;
    currentSession = parseSessionFromText(line) || currentSession;
    const lineAssignees = findAssignees(line);
    if (lineAssignees.length) currentAssignees = lineAssignees;

    const urls = [...line.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/gi)]
      .map(match => normalizeGitHubUrl(match[0]))
      .filter(Boolean);

    for (const ticketUrl of new Set(urls)) {
      const assignees = lineAssignees.length ? lineAssignees : currentAssignees;
      for (const assignee of assignees.filter(name => selected.has(name))) {
        entries.push({
          assignee,
          date: currentDate,
          session: currentSession,
          ticketUrl,
          line: lineIndex + 1,
          raw: line.trim()
        });
      }
    }
  });

  return entries.filter(entry => entry.date && entry.session);
}

export function fallbackStart(date, session) {
  const hour = session?.startsWith('11') ? '09:00:00' : '13:00:00';
  return `${date}T${hour}+07:00`;
}
