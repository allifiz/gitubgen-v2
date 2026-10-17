// Full canonical input is retained: no hash collision can reuse an unrelated checkpoint.
export function jobFingerprint(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return JSON.stringify(canonical(value));
}
export function inputContext(entries) {
  return jobFingerprint(
    entries
      .map((e) => ({
        assignee: e.assignee,
        date: e.date,
        session: e.session,
        url: e.ticketUrl,
        title: e.ticketTitle,
        status: e.status,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
