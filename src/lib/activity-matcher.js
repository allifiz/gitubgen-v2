export const RULE_VERSION = "intervals-2026-10-17.1";
export const PROJECT_NUMBER = 11;
const TZ = "Asia/Jakarta";
export function localDate(iso) {
  if (!iso || !Number.isFinite(+new Date(iso))) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
export function normalizeStatus(value = "") {
  const s = String(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^in\s*progress$/.test(s) ? "in progress" : s;
}
export function transitionTarget(event, projectNumber = PROJECT_NUMBER) {
  if (
    event.type !== "status" ||
    event.projectScopeUnknown ||
    (event.projectNumber != null &&
      Number(event.projectNumber) !== projectNumber)
  )
    return null;
  if (event.status != null || event.newStatus != null)
    return normalizeStatus(event.status ?? event.newStatus) || "no status";
  // Compatibility with saved status events only. Ordinary comments are never parsed.
  const m = String(event.text || "").match(
    /(?:moved this (?:from .*? )?to|status(?: changed)? to)\s+(In Progress|Ready to Review|Done Review|Staging|Deployed|Todo|No status)\b/i,
  );
  return m ? normalizeStatus(m[1]) : null;
}
const marker = (e, m) =>
  e.type === "comment" &&
  String(e.body || "")
    .trim()
    .toLowerCase() === `/${m}`;
const work = (e) =>
  ["commit", "pull_request"].includes(e.type) &&
  e.relationshipType !== "mention";

export function reconcileEvents(events) {
  const sorted = [...events]
    .filter((e) => Number.isFinite(+new Date(e.datetime)))
    .sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  const result = [];
  for (const event of sorted) {
    const exact = result.find(
      (e) => event.id && e.id === event.id && e.source === event.source,
    );
    if (exact) continue;
    const candidate =
      event.type === "status" &&
      event.recorderSource !== "baseline" &&
      result.find(
        (e) =>
          e.type === "status" &&
          e.source !== event.source &&
          e.recorderSource !== "baseline" &&
          normalizeStatus(e.status ?? e.newStatus) ===
            normalizeStatus(event.status ?? event.newStatus) &&
          e.previousStatus != null &&
          event.previousStatus != null &&
          normalizeStatus(e.previousStatus) ===
            normalizeStatus(event.previousStatus) &&
          (e.projectNumber ?? 11) === (event.projectNumber ?? 11) &&
          (!e.projectItemId ||
            !event.projectItemId ||
            e.projectItemId === event.projectItemId) &&
          Math.abs(+new Date(e.datetime) - +new Date(event.datetime)) <= 3000 &&
          !result.some(
            (other) =>
              other !== e &&
              other.type === "status" &&
              (other.projectNumber ?? 11) === (event.projectNumber ?? 11) &&
              +new Date(other.datetime) > +new Date(e.datetime) &&
              +new Date(other.datetime) < +new Date(event.datetime) &&
              normalizeStatus(other.status ?? other.newStatus) !==
                normalizeStatus(event.status ?? event.newStatus),
          ),
      );
    if (candidate) {
      const native = event.source === "graphql" ? event : candidate;
      const observations = [
        ...(candidate.observations || [candidate]),
        event,
      ].map((e) => ({
        datetime: e.datetime,
        source: e.source,
        id: e.id,
        detectedAt: e.detectedAt,
      }));
      Object.assign(candidate, native, { observations });
    } else result.push({ ...event });
  }
  return result.sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
}

export function relatedScans(ticketUrl, scans, maxDepth = 3) {
  const found = [],
    seen = new Set(),
    queue = [{ url: ticketUrl, depth: 0, path: [ticketUrl] }];
  while (queue.length) {
    const item = queue.shift();
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const scan = scans[item.url];
    if (!scan) continue;
    found.push({ ...item, scan });
    if (item.depth >= maxDepth) continue;
    const relations =
      scan.relationships ||
      (scan.linkedUrls || []).map((url) => ({ url, type: "legacy" }));
    for (const r of relations)
      if (!["mention", "disconnected"].includes(r.type))
        queue.push({
          url: r.url,
          depth: item.depth + 1,
          path: [...item.path, r.url],
        });
  }
  return found;
}
export function decideTimes(entry, scansByUrl, options = {}) {
  const projectNumber = Number(entry.projectNumber || 11),
    dayStart = `${entry.date}T00:00:00+07:00`;
  const next = new Date(+new Date(dayStart) + 86400000).toISOString(),
    at = (t) => `${entry.date}T${t}+07:00`;
  const nodes = relatedScans(
      entry.ticketUrl,
      scansByUrl,
      options.maxDepth ?? 3,
    ),
    parent = scansByUrl[entry.ticketUrl];
  const events = reconcileEvents(
    (parent?.events || []).map((e) => ({
      ...e,
      sourceUrl: entry.ticketUrl,
      sourceKind: "parent",
    })),
  ).filter((e) => +new Date(e.datetime) < +new Date(next));
  const today = events.filter((e) => localDate(e.datetime) === entry.date);
  const linked = nodes
    .filter((n) => n.depth)
    .flatMap((n) =>
      (n.scan.events || [])
        .filter((e) => localDate(e.datetime) === entry.date)
        .map((e) => ({
          ...e,
          sourceUrl: n.url,
          sourceKind: "linked",
          relationshipPath: n.path,
        })),
    );
  const flags = new Set(entry.warnings || []),
    intervals = [];
  if (today.some((e) => e.projectScopeUnknown))
    flags.add("UNKNOWN_PROJECT_SCOPE");
  for (const { scan } of nodes)
    if ((scan.linkedUrls || []).some((url) => !scansByUrl[url]))
      flags.add("RELATED_EVIDENCE_NOT_COLLECTED");
  let state = null,
    active = null,
    startEvidence = null,
    endEvidence = null;
  for (const e of events.filter(
    (e) => +new Date(e.datetime) < +new Date(dayStart),
  )) {
    const target = transitionTarget(e, projectNumber);
    if (target) {
      state = target;
      active = target === "in progress" ? e : null;
    }
    if (marker(e, "start")) {
      state = "in progress";
      active = e;
    }
    if (marker(e, "end")) {
      state = "ended";
      active = null;
    }
  }
  if (active) {
    active = {
      ...active,
      datetime: at("09:00:00"),
      policy: "policy_carryover",
      rawDatetime: active.datetime,
    };
    flags.add("POLICY_CARRYOVER_09");
  }
  for (const e of today) {
    const target = transitionTarget(e, projectNumber),
      begins = target === "in progress" || marker(e, "start");
    if (begins) {
      if (!active) {
        active = e;
        if (!startEvidence) startEvidence = e;
      }
      if (e.recorderSource === "baseline") flags.add("BASELINE_STATE");
      state = "in progress";
      continue;
    }
    if ((target && target !== "in progress") || marker(e, "end")) {
      if (active) {
        if (+new Date(e.datetime) >= +new Date(active.datetime)) {
          const reason = marker(e, "end")
            ? "explicit_end"
            : target === "ready to review"
              ? "ready_to_review"
              : `exit_${target.replaceAll(" ", "_")}`;
          intervals.push({
            start: active.datetime,
            end: e.datetime,
            startEvent: active,
            endEvent: e,
            reason,
          });
          if (!startEvidence) startEvidence = active;
          endEvidence = e;
          if (["todo", "no status"].includes(target))
            flags.add("PAUSED_OR_RESET");
          if (+new Date(e.datetime) - +new Date(active.datetime) < 60000)
            flags.add("SHORT_STATUS_CYCLE");
          if (
            !["ready to review", "todo", "no status"].includes(target) &&
            !marker(e, "end")
          )
            flags.add("DIRECT_EXIT_FALLBACK");
        }
        active = null;
      } else if (target === "ready to review" || marker(e, "end")) {
        endEvidence = e;
        flags.add("UNPAIRED_END");
      }
      state = target || "ended";
    }
    if (
      target &&
      ![
        "in progress",
        "todo",
        "no status",
        "ready to review",
        "done review",
        "staging",
        "deployed",
      ].includes(target)
    )
      flags.add("UNKNOWN_STATUS");
  }
  const close = workdayCloseIso(entry.date),
    now = +(options.now || new Date());
  if (
    active &&
    normalizeStatus(entry.status) === "in progress" &&
    (entry.sessions || [entry.session]).some((s) => /^16:/.test(s || "")) &&
    close &&
    +new Date(active.datetime) < +new Date(close) &&
    now >= +new Date(close)
  ) {
    // Only an actually open status interval qualifies; a stale DSM status does not.
    intervals.push({
      start: active.datetime,
      end: close,
      startEvent: active,
      endEvent: null,
      reason: "policy_workday_close",
    });
    flags.add("POLICY_WORKDAY_CLOSE");
    startEvidence ||= active;
    active = null;
  }
  const activities = [...today, ...linked]
    .filter((e) => work(e) || marker(e, "end"))
    .sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  const lastWork = activities.at(-1),
    lastPair = intervals.at(-1);
  if (
    lastPair &&
    lastWork &&
    +new Date(lastWork.datetime) > +new Date(lastPair.end) &&
    !active
  )
    flags.add("UNPAIRED_WORK_AFTER_REVIEW");
  const assignments = events.filter((e) => e.type === "assignment");
  if (
    assignments.some((e) => localDate(e.datetime) === entry.date) ||
    parent?.assignees?.length > 1
  )
    flags.add("ASSIGNMENT_REVIEW");
  const mapping = options.picLogins || {
    allief: ["allifgobimbel"],
    maulana: ["maslanadev", "maulanagobimbel"],
    dwiki: ["dwikyananditya"],
    hizkia: ["hizkiagobimbel"],
  };
  if (
    parent?.assignees?.length &&
    !(mapping[entry.assignee] || []).some((v) => parent.assignees.includes(v))
  )
    flags.add("PIC_IDENTITY_REVIEW");
  if (!parent) flags.add("PARENT_NOT_COLLECTED");
  for (const n of nodes)
    if (n.scan.warnings?.length || n.scan.coverage?.complete === false)
      flags.add("PARTIAL_SOURCE_COVERAGE");
  let start =
    intervals[0]?.start || active?.datetime || startEvidence?.datetime || null;
  let end =
    lastPair?.end || endEvidence?.datetime || lastWork?.datetime || null;
  if (active) {
    start ||= active.datetime;
    end = lastWork?.datetime || null;
    flags.add("MISSING_COMPLETION");
  }
  if (!start) flags.add("MISSING_START");
  if (!end) flags.add("MISSING_END");
  if (start && end && +new Date(end) < +new Date(start)) {
    flags.add("REVERSED_EVIDENCE");
    end = null;
  }
  if (!intervals.length && lastWork) flags.add("ACTIVITY_OBSERVATION_ONLY");
  const seconds = intervals.reduce(
    (sum, i) =>
      sum + Math.round(effectiveWorkHours(i.start, i.end) * 3600000) / 1000,
    0,
  );
  const hours =
    start && end && intervals.length && !active ? seconds / 3600 : null;
  if (hours === 0) flags.add("ZERO_EFFECTIVE_DURATION");
  if (hours > 0 && seconds < 36) flags.add("SUB_DISPLAY_PRECISION");
  const baseline = events.some(
    (e) =>
      e.recorderSource === "baseline" &&
      [startEvidence, endEvidence].includes(e),
  );
  if (baseline) flags.add("BASELINE_STATE");
  const policy = [...flags].some((f) => f.startsWith("POLICY_"));
  if (today.some((e) => e.type === "observation" || e.gap))
    flags.add("POLLING_OBSERVATION_GAP");
  const needsReview = flags.size > 0;
  return {
    start,
    end,
    hours,
    seconds: hours == null ? null : seconds,
    intervals: intervals.map((i) => ({
      ...i,
      effectiveSeconds:
        Math.round(effectiveWorkHours(i.start, i.end) * 3600000) / 1000,
    })),
    rule: !start
      ? "MISSING_START"
      : !end
        ? "MISSING_END"
        : intervals.length
          ? "STATUS_INTERVALS"
          : "PARTIAL_EVIDENCE",
    flags: [...flags],
    needsReview,
    confidence: !start || !end ? "LOW" : needsReview ? "MEDIUM" : "HIGH",
    startConfidence: !start ? "UNKNOWN" : policy ? "POLICY" : "OBSERVED",
    endConfidence: !end
      ? "UNKNOWN"
      : !intervals.length
        ? "ACTIVITY_OBSERVATION"
        : policy
          ? "POLICY"
          : "OBSERVED",
    startSource: startEvidence?.policy || startEvidence?.sourceUrl || null,
    endSource:
      lastPair?.reason === "policy_workday_close"
        ? "policy_workday_close"
        : endEvidence?.sourceUrl || lastWork?.sourceUrl || null,
    startSourceKind: startEvidence?.sourceKind || "",
    endSourceKind: endEvidence?.sourceKind || lastWork?.sourceKind || "",
    startEvidence: startEvidence?.text || "",
    endEvidence: endEvidence?.text || lastWork?.text || "",
    lastWorkAt: lastWork?.datetime || null,
    evidence: [...today, ...linked],
    relationshipPaths: nodes.map((n) => n.path),
    ruleVersion: RULE_VERSION,
    projectNumber,
    state,
  };
}
function workdayCloseIso(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? null : `${date}T${day === 6 ? "16" : "17"}:00:00+07:00`;
}
export function effectiveWorkHours(startIso, endIso) {
  if (!startIso || !endIso || +new Date(endIso) <= +new Date(startIso))
    return 0;
  const date = localDate(startIso);
  if (!date || localDate(endIso) !== date) return 0;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0) return 0;
  const at = (t) => +new Date(`${date}T${t}+07:00`),
    start = Math.max(+new Date(startIso), at("09:00:00")),
    end = Math.min(+new Date(endIso), at(day === 6 ? "16:00:00" : "17:00:00"));
  if (end <= start) return 0;
  const [a, b] =
    day === 5 ? ["11:30:00", "13:30:00"] : ["12:00:00", "13:00:00"];
  return (
    Math.max(
      0,
      end - start - Math.max(0, Math.min(end, at(b)) - Math.max(start, at(a))),
    ) / 3600000
  );
}
export function uniqueTicketPeriod(entries, scans) {
  const first = [...entries].sort((a, b) => a.date.localeCompare(b.date))[0];
  const events = (scans[first.ticketUrl]?.events || [])
    .filter((e) => e.datetime)
    .sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  return {
    startDate:
      localDate(
        events.find((e) => transitionTarget(e) === "in progress")?.datetime,
      ) || first.date,
    endDate:
      localDate(
        events
          .filter(
            (e) =>
              transitionTarget(e) === "deployed" ||
              (e.type === "issue_state" && e.state === "closed"),
          )
          .at(-1)?.datetime,
      ) || "",
  };
}
export function targetDateForTicket(url, scans) {
  return scans[url]?.targetDate || "";
}
export function latestGitHubStatus(url, scans, asOf = null) {
  return (
    (scans[url]?.events || [])
      .filter((e) => !asOf || +new Date(e.datetime) <= +new Date(asOf))
      .map((e) => ({ ...e, target: transitionTarget(e) }))
      .filter((e) => e.target)
      .sort((a, b) => +new Date(b.datetime) - +new Date(a.datetime))[0]
      ?.target || ""
  );
}
export function isNextWorkday(previous, current) {
  const n = new Date(`${previous}T00:00:00Z`);
  if (!Number.isFinite(+n)) return false;
  do n.setUTCDate(n.getUTCDate() + 1);
  while (n.getUTCDay() === 0);
  return n.toISOString().slice(0, 10) === current;
}
export function decisionRows(entries, scans) {
  const rows = entries.map((entry) => ({
    entry,
    decision: decideTimes(entry, scans),
  }));
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i],
        b = rows[j];
      if (
        a.entry.assignee !== b.entry.assignee ||
        a.entry.date !== b.entry.date ||
        a.entry.ticketUrl === b.entry.ticketUrl
      )
        continue;
      if (
        a.decision.intervals.some((x) =>
          b.decision.intervals.some(
            (y) =>
              Math.max(+new Date(x.start), +new Date(y.start)) <
              Math.min(+new Date(x.end), +new Date(y.end)),
          ),
        )
      ) {
        for (const r of [a, b]) {
          r.decision.flags = [
            ...new Set([...r.decision.flags, "OVERLAPPING_TICKETS"]),
          ];
          r.decision.needsReview = true;
          r.decision.confidence = "MEDIUM";
        }
      }
    }
  return rows;
}
