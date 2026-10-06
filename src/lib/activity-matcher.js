import { fallbackStart } from './dsm-parser.js';

const TZ = 'Asia/Jakarta';
const START_STATUSES = new Set(['todo', 'in progress']);
const IGNORED_END = /(assigned|unassigned|mentioned this|added this to|added a parent issue|added sub-issues?|converted this|changed the title|transferred this)/i;
const WORK_ACTIVITY = /(linked a pull request|pull request|merged(?: commit| .* into)|commit(?:ted)?|closed this|closed as completed)/i;

function localParts(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date(iso)).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
}

function localDate(iso) {
  const p = localParts(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

function normalizeStatus(value = '') {
  return String(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function transitionTarget(event) {
  const text = `${event.type || ''} ${event.text || ''}`.replace(/\s+/g, ' ');
  const match = text.match(/(?:moved this (?:from .*? )?to|changed (?:the )?status(?: from .*?)? to|status(?: changed)? to)\s+(Todo|In Progress|Ready to Review|Staging|Deployed)\b/i);
  return match ? normalizeStatus(match[1]) : null;
}

function relevantEvents(scan, date, sourceKind = 'parent') {
  return (scan?.events || [])
    .filter(event => event.datetime && localDate(event.datetime) === date)
    .map(event => ({ ...event, sourceUrl: scan.url, sourceKind, targetStatus: transitionTarget(event) }))
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function eventPriority(event, targetStatus) {
  if (event.sourceKind === 'parent' && event.targetStatus === targetStatus) return 100;
  if (event.targetStatus === targetStatus) return 90;
  const text = `${event.type || ''} ${event.text || ''}`.toLowerCase();
  if (IGNORED_END.test(text)) return 0;
  if (targetStatus === 'deployed' && /(closed this|closed as completed)/.test(text)) return event.sourceKind === 'parent' ? 95 : 85;
  if (targetStatus === 'staging' && /merged(?: commit| .* into) staging/.test(text)) return event.sourceKind === 'parent' ? 88 : 85;
  if (WORK_ACTIVITY.test(text)) return event.sourceKind === 'parent' ? 80 : 70;
  return 0;
}

function pickEnd(events, targetStatus) {
  return events.map(event => ({ event, priority: eventPriority(event, targetStatus) }))
    .filter(item => item.priority > 0)
    .sort((a, b) => b.priority - a.priority || new Date(b.event.datetime) - new Date(a.event.datetime))[0]?.event || null;
}

export function decideTimes(entry, scansByUrl) {
  const parent = scansByUrl[entry.ticketUrl];
  const parentEvents = relevantEvents(parent, entry.date, 'parent');
  const linkedEvents = (parent?.linkedUrls || []).flatMap(url => relevantEvents(scansByUrl[url], entry.date, 'linked'));
  const allEvents = [...parentEvents, ...linkedEvents].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const targetStatus = normalizeStatus(entry.status);
  let end = pickEnd(allEvents, targetStatus);
  const sessions = entry.sessions || [entry.session].filter(Boolean);
  const isLateInProgress = targetStatus.startsWith('in progress') && sessions.some(session => /^16:/.test(session));
  const workdayEnd = isLateInProgress ? workdayCloseIso(entry.date) : null;
  if (workdayEnd) {
    const startEvent = allEvents.find(event => START_STATUSES.has(event.targetStatus));
    const start = entry.continuedFromPreviousDay
      ? startOfWorkdayIso(entry.date)
      : startEvent?.datetime || fallbackStart(entry.date, entry.firstSession || sessions[0] || entry.session);
    return decision(start,workdayEnd,'IN_PROGRESS_UNTIL_WORKDAY_END',
      entry.continuedFromPreviousDay ? 'CONTINUED 09:00' : startEvent?.sourceUrl || `DSM ${entry.firstSession || sessions[0] || entry.session}`,
      'WORKDAY_END','MEDIUM',{startEvent,endEvent:null});
  }
  if (!end) return { start:null,end:null,hours:null,rule:'NEEDS_REVIEW_NO_VALID_END',startSource:null,endSource:null,confidence:'LOW',needsReview:true };

  // "In Progress" adalah penanda mulai, bukan penanda selesai. Jika ada bukti
  // kerja setelah transisi tersebut pada hari yang sama, gunakan aktivitas
  // terakhir itu sebagai titik observasi akhir tanpa mengubah status DSM.
  if (targetStatus.startsWith('in progress')) {
    const laterWork = allEvents.filter(event =>
      new Date(event.datetime) > new Date(end.datetime) &&
      !IGNORED_END.test(`${event.type || ''} ${event.text || ''}`) &&
      (WORK_ACTIVITY.test(`${event.type || ''} ${event.text || ''}`) || event.targetStatus)
    ).at(-1);
    if (laterWork) end = laterWork;
  }

  const candidates = allEvents.filter(event => START_STATUSES.has(event.targetStatus) && new Date(event.datetime) < new Date(end.datetime));
  const parentStarts = candidates.filter(event => event.sourceKind === 'parent');
  const startEvent = (parentStarts.length ? parentStarts : candidates)[0] || null;
  const firstSession = entry.firstSession || entry.sessions?.[0] || entry.session;
  const start = entry.continuedFromPreviousDay ? startOfWorkdayIso(entry.date) : startEvent?.datetime || fallbackStart(entry.date, firstSession);
  const rule = startEvent ? (startEvent.sourceKind === 'parent' ? 'PARENT_START_MATCHED_END' : 'LINKED_START_MATCHED_END') : 'DSM_FALLBACK_MATCHED_GITHUB_END';
  return decision(start,end.datetime,rule,startEvent?.sourceUrl || `DSM ${firstSession}`,end.sourceUrl,startEvent && end.sourceKind === 'parent' ? 'HIGH' : startEvent ? 'MEDIUM' : 'LOW',{startEvent,endEvent:end});
}

function startOfWorkdayIso(date) {
  return `${date}T09:00:00+07:00`;
}

function workdayCloseIso(date) {
  const [year,month,day]=date.split('-').map(Number);
  const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay();
  if (weekday===0) return null;
  return `${date}T${weekday===6?'16:00:00':'17:00:00'}+07:00`;
}

export function effectiveWorkHours(startIso, endIso) {
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) return 0;
  const date = localDate(startIso);
  if (!date || localDate(endIso) !== date) return 0;
  const [year,month,day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year,month-1,day)).getUTCDay();
  if (weekday === 0) return 0;
  const close = weekday === 6 ? '16:00:00' : '17:00:00';
  const breaks = weekday === 5 ? [['11:30:00','13:30:00']] : [['12:00:00','13:00:00']];
  const at = time => new Date(`${date}T${time}+07:00`).getTime();
  const start = Math.max(new Date(startIso).getTime(),at('09:00:00'));
  const end = Math.min(new Date(endIso).getTime(),at(close));
  if (end <= start) return 0;
  let ms=end-start;
  for (const [a,b] of breaks) ms-=Math.max(0,Math.min(end,at(b))-Math.max(start,at(a)));
  return Math.max(0,ms/3_600_000);
}

function decision(start,end,rule,startSource,endSource,confidence,evidence={}) {
  const hours=effectiveWorkHours(start,end);
  return {
    start,end,hours,rule,startSource,endSource,confidence,
    startSourceKind:evidence.startEvent?.sourceKind || (String(startSource || '').startsWith('DSM ') ? 'dsm-fallback' : ''),
    endSourceKind:evidence.endEvent?.sourceKind || '',
    startEvidence:evidence.startEvent?.text||'',endEvidence:evidence.endEvent?.text||'',
    needsReview:hours<=0
  };
}

export function uniqueTicketPeriod(entries,scansByUrl) {
  const first=[...entries].sort((a,b)=>a.date.localeCompare(b.date))[0];
  const parent=scansByUrl[first.ticketUrl];
  const events=(parent?.events||[]).filter(e=>e.datetime).map(e=>({...e,targetStatus:transitionTarget(e)})).sort((a,b)=>new Date(a.datetime)-new Date(b.datetime));
  const start=events.find(e=>START_STATUSES.has(e.targetStatus));
  const close=[...events].reverse().find(e=>e.targetStatus==='deployed'||/(closed this|closed as completed)/i.test(`${e.type||''} ${e.text||''}`));
  return {startDate:localDate(start?.datetime)||first.date,endDate:localDate(close?.datetime)||''};
}

export function targetDateForTicket(ticketUrl, scansByUrl) {
  return scansByUrl[ticketUrl]?.targetDate || '';
}
