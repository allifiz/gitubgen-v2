import { normalizeGitHubUrl } from "./github-url.js";

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  januari: 0,
  februari: 1,
  maret: 2,
  mei: 4,
  juni: 5,
  juli: 6,
  agustus: 7,
  oktober: 9,
  desember: 11,
};

const ALIASES = {
  allief: ["allief", "allif", "allifgobimbel"],
  hizkia: ["hizkia", "hizkiagobimbel"],
  maulana: ["maulana", "maulanagobimbel", "maslanadev"],
  dwiki: ["dwiki", "dwiky", "dwikigobimbel", "dwikygobimbel", "dwikyananditya"],
};

function pad(value) {
  return String(value).padStart(2, "0");
}

export function parseDateFromText(text, yearHint = new Date().getFullYear()) {
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (numeric)
    return validDate(`${numeric[3]}-${pad(numeric[2])}-${pad(numeric[1])}`);

  const named = text.toLowerCase().match(/\b(\d{1,2})\s+([a-z]+)\s*(\d{4})?\b/);
  if (named && MONTHS[named[2]] !== undefined) {
    return validDate(
      `${named[3] || yearHint}-${pad(MONTHS[named[2]] + 1)}-${pad(named[1])}`,
    );
  }
  return null;
}

function validDate(value) {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function parseSessionFromText(text) {
  const match = text.match(
    /\b(?:pukul|jam|dsm|sesi)\s*[:=-]?\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\b/i,
  );
  return match ? `${pad(match[1])}:${match[2] || "00"}` : null;
}

function findAssignees(text) {
  return Object.entries(ALIASES)
    .filter(([, aliases]) =>
      aliases.some((alias) => new RegExp(`^${alias}$`, "i").test(text.trim())),
    )
    .map(([name]) => name);
}

export function parseDsm(markdown, options = {}) {
  const selected = new Set(
    (options.assignees || Object.keys(ALIASES)).map((v) => v.toLowerCase()),
  );
  const entries = [];
  let date = null,
    session = null,
    assignees = [],
    title = "",
    indexes = [],
    inTask = false;
  for (const [lineIndex, raw] of markdown.split(/\r?\n/).entries()) {
    const line = cleanMarkdown(raw).replace(/^#+\s*/, "");
    // Only structural date headers can change context. Prose/deadlines cannot.
    const isListItem = /^\s*[-*]\s/.test(raw);
    const isDateHeader =
      !isListItem &&
      /^(?:(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu),?\s+)?\d{1,2}(?:[/-]\d{1,2}[/-]\d{4}|\s+[a-z]+(?:\s+\d{4})?)(?:\s*(?:-|–)?\s*(?:pukul|jam|dsm|sesi)\b.*)?$/i.test(
        line,
      );
    if (isDateHeader) {
      date = parseDateFromText(line, options.year || new Date().getFullYear());
      session = parseSessionFromText(line);
      assignees = [];
      indexes = [];
      inTask = false;
      title = "";
      continue;
    }
    if (/^(?:pukul|jam|dsm|sesi)\b/i.test(line) && parseSessionFromText(line)) {
      session = parseSessionFromText(line);
      indexes = [];
      inTask = false;
      continue;
    }
    const people = line.split(/\s*(?:,|&|dan)\s*/i).flatMap(findAssignees);
    if (
      !isListItem &&
      people.length &&
      people.length === line.split(/\s*(?:,|&|dan)\s*/i).length
    ) {
      assignees = people;
      indexes = [];
      title = "";
      inTask = false;
      continue;
    }
    const task = line.match(/^Task\s+\d+\s*\|\s*(.+)$/i);
    if (task) {
      title = task[1];
      indexes = [];
      inTask = true;
      continue;
    }
    const status = line.match(/^Status\s*:\s*(.+)$/i);
    if (status) {
      for (const index of indexes) entries[index].status = status[1].trim();
      continue;
    }
    const githubField = /^GitHub\s*:/i.test(line);
    // Retain the original simple heading + URL format, outside structured tasks only.
    if (!githubField && (inTask || !/^(?:Kerjakan\s+)?https?:\/?/i.test(line)))
      continue;
    const urls = [
      ...raw
        .replace(/https\\:\/\//gi, "https://")
        .matchAll(
          /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/gi,
        ),
    ]
      .map((m) => normalizeGitHubUrl(m[0]))
      .filter(Boolean);
    for (const ticketUrl of new Set(urls))
      for (const assignee of assignees.filter((v) => selected.has(v))) {
        if (!date || !session) continue;
        entries.push({
          assignee,
          date,
          session,
          ticketUrl,
          ticketTitle: title,
          status: "",
          line: lineIndex + 1,
          raw: raw.trim(),
          sourceLine: lineIndex + 1,
          warnings: urls.length > 1 ? ["MULTIPLE_GITHUB_URLS"] : [],
        });
        indexes.push(entries.length - 1);
      }
  }
  return entries;
}

function cleanMarkdown(value = "") {
  return String(value)
    .replace(/\\([_\[\]*:#-])/g, "$1")
    .replace(/^\s*[-*]+\s*/, "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sessionMinutes(session) {
  const match = String(session || "").match(/^(\d{1,2}):(\d{2})$/);
  return match
    ? Number(match[1]) * 60 + Number(match[2])
    : Number.MAX_SAFE_INTEGER;
}

export function collapseDailyEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.assignee}|${entry.ticketUrl}|${entry.date}`;
    const current = grouped.get(key) || [];
    current.push(entry);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((group) => {
      const ordered = [...group].sort(
        (a, b) => sessionMinutes(a.session) - sessionMinutes(b.session),
      );
      const latestWithStatus = [...ordered]
        .reverse()
        .find((entry) => entry.status);
      const latestWithTitle = [...ordered]
        .reverse()
        .find((entry) => entry.ticketTitle);
      return {
        ...ordered[0],
        ticketTitle:
          latestWithTitle?.ticketTitle || ordered[0].ticketTitle || "",
        status: latestWithStatus?.status || "",
        sessions: ordered.map((entry) => entry.session).filter(Boolean),
        occurrences: ordered.length,
        firstSession: ordered[0].session,
        lastSession: ordered.at(-1).session,
      };
    })
    .sort((a, b) =>
      `${a.date}|${a.assignee}|${a.ticketUrl}`.localeCompare(
        `${b.date}|${b.assignee}|${b.ticketUrl}`,
      ),
    );
}
