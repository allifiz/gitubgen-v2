export function transitionToEvent(t) {
  return {
    id: `recorder:${t.id || `${t.projectItemId}|${t.newStatus}|${t.occurredAt}`}`,
    type: t.observationOnly ? "observation" : "status",
    datetime: t.occurredAt,
    text: `GitubGen Recorder moved this${t.previousStatus ? ` from ${t.previousStatus}` : ""} to ${t.newStatus}`,
    status: t.newStatus,
    previousStatus: t.previousStatus,
    url: t.issueUrl,
    source: "recorder",
    recorderSource: t.source,
    detectedAt: t.detectedAt,
    projectItemId: t.projectItemId,
    projectNumber: t.projectNumber || 11,
    issueNodeId: t.issueNodeId,
    gap: t.gap,
  };
}
export async function fetchRecorderHistory(
  config,
  issueUrls,
  range = {},
  fetchImpl = fetch,
) {
  const base = new URL(String(config?.url || "").trim());
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw new Error("Recorder URL wajib menggunakan HTTPS.");
  if (!config?.secret) throw new Error("Recorder API secret wajib diisi.");
  const urls = [...new Set(issueUrls)],
    byUrl = {},
    coverage = [];
  for (let i = 0; i < urls.length; i += 200) {
    const chunk = urls.slice(i, i + 200);
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetchImpl(
        `${base.toString().replace(/\/$/, "")}/api/status-history`,
        {
          method: "POST",
          signal: AbortSignal.timeout(20000),
          headers: {
            authorization: `Bearer ${config.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            issueUrls: chunk,
            ...range,
            includeContext: true,
          }),
        },
      );
      if (response.ok || response.status < 500 || attempt) break;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok)
      throw new Error(data.error || `Recorder HTTP ${response.status}`);
    if (data.coverage?.truncated)
      throw new Error("Recorder mengembalikan history terpotong.");
    coverage.push(data.coverage || { complete: false, legacy: true });
    for (const url of chunk) byUrl[url] = [];
    for (const t of [
      ...(data.context || []),
      ...(data.history || []),
      ...(data.observations || []),
    ]) {
      const e = transitionToEvent(t);
      for (const url of t.requestedUrls || [t.issueUrl])
        if (chunk.includes(url)) (byUrl[url] ||= []).push(e);
    }
  }
  Object.defineProperty(byUrl, "coverage", {
    value: coverage,
    enumerable: false,
  });
  return byUrl;
}
