import { fetchActivity } from "./lib/github-graphql.js";
import { fetchRecorderHistory } from "./lib/recorder-api.js";
import { reconcileEvents, RULE_VERSION } from "./lib/activity-matcher.js";
import { jobFingerprint } from "./lib/job.js";
const STORAGE_KEY = "gitubgenJob",
  CONCURRENCY = 4,
  MAX_NODES = 1500;
let running = false;
chrome.runtime.onInstalled.addListener(() =>
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {}),
);
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.type === "START_SCAN") {
    if (running) {
      reply({ ok: false, error: "Scan masih berjalan." });
      return;
    }
    startScan(
      m.items,
      m.maxDepth ?? 3,
      m.githubToken,
      m.recorder,
      m.inputContext,
    ).catch(() => {});
    reply({ ok: true });
    return;
  }
  if (m.type === "GET_JOB") {
    chrome.storage.local
      .get(STORAGE_KEY)
      .then((data) => reply(data[STORAGE_KEY] || null));
    return true;
  }
  if (m.type === "CLEAR_JOB") {
    if (running) {
      reply({ ok: false, error: "Tunggu scan selesai sebelum reset." });
      return;
    }
    chrome.storage.local.remove(STORAGE_KEY).then(() => reply({ ok: true }));
    return true;
  }
});
export async function startScan(
  inputItems,
  maxDepth,
  githubToken,
  recorder,
  inputContext = "",
) {
  if (running) throw new Error("Scan masih berjalan.");
  running = true;
  let job;
  try {
    const inputs = mergeInputItems(inputItems),
      depth = Math.max(0, Math.min(3, maxDepth)),
      fingerprint = jobFingerprint({
        inputs,
        maxDepth: depth,
        inputContext,
        ruleVersion: RULE_VERSION,
        projectNumber: 11,
        recorderUrl: recorder?.url || "",
      });
    const previous = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    job =
      previous?.fingerprint === fingerprint &&
      ["paused", "running"].includes(previous.status)
        ? previous
        : {
            status: "running",
            queue: inputs.map((i) => ({ ...i, depth: 0 })),
            scans: {},
            errors: [],
            warnings: [],
            processed: 0,
            total: inputs.length,
            startedAt: new Date().toISOString(),
            maxDepth: depth,
            fingerprint,
            inputs,
            inputContext,
            ruleVersion: RULE_VERSION,
          };
    job.queue = mergeInputItems([...(job.inFlight || []), ...job.queue])
      .map((i) => ({
        ...i,
        depth: Math.min(
          ...[...(job.inFlight || []), ...job.queue]
            .filter((q) => q.url === i.url)
            .map((q) => q.depth),
        ),
      }))
      .filter((i) => !job.scans[i.url]);
    job.inFlight = [];
    job.status = "running";
    delete job.fatalError;
    await saveAndNotify(job);
    while (job.queue.length) {
      const batch = job.queue
        .splice(0, CONCURRENCY)
        .filter((i) => !job.scans[i.url]);
      if (!batch.length) continue;
      job.inFlight = batch;
      await saveAndNotify(job);
      let history = {};
      let recorderError = null;
      if (recorder?.url && recorder?.secret) {
        try {
          history = await fetchRecorderHistory(
            recorder,
            batch.map((i) => i.url),
            recorderRange(inputs),
          );
          job.recorderConnected = true;
          job.recorderCoverage = history.coverage;
        } catch (e) {
          recorderError = e.message;
          job.recorderError = e.message;
        }
      }
      const results = await Promise.all(
        batch.map(async (item) => {
          let scan, error;
          try {
            scan = await fetchActivity(item.url, githubToken, fetch, {
              budget: (job.requestBudget ||= { used: 0, limit: 1200 }),
            });
          } catch (e) {
            error = e.message;
          }
          if (!scan)
            scan = {
              url: item.url,
              title: "",
              events: [],
              linkedUrls: [],
              relationships: [],
              warnings: [error],
              coverage: { complete: false, core: false, project: false },
            };
          scan.events = reconcileEvents([
            ...(scan.events || []),
            ...(history[item.url] || []),
          ]);
          scan.sourceCoverage = {
            github: !error,
            recorder: !!history[item.url],
            recorderError,
          };
          return { item, scan, error };
        }),
      );
      for (const { item, scan, error } of results) {
        job.scans[item.url] = scan;
        if (error) job.errors.push({ url: item.url, error });
        for (const warning of scan.warnings || [])
          job.warnings.push({ url: item.url, warning });
        if (item.depth < job.maxDepth)
          for (const url of scan.linkedUrls || []) {
            if (job.scans[url] || batch.some((i) => i.url === url)) continue;
            const queued = job.queue.find((i) => i.url === url);
            if (queued) {
              queued.dates = [...new Set([...queued.dates, ...item.dates])];
              for (const [date, statuses] of Object.entries(item.targets))
                queued.targets[date] = [
                  ...new Set([...(queued.targets[date] || []), ...statuses]),
                ];
              queued.depth = Math.min(queued.depth, item.depth + 1);
            } else if (job.total < MAX_NODES) {
              job.queue.push({ ...item, url, depth: item.depth + 1 });
              job.total++;
            } else
              job.warnings.push({ url, warning: "GRAPH_NODE_BUDGET_REACHED" });
          }
        job.processed++;
      }
      job.inFlight = [];
      await saveAndNotify(job);
    }
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    await saveAndNotify(job);
  } catch (e) {
    job ||= { queue: [], scans: {}, errors: [], processed: 0, total: 0 };
    job.status = "paused";
    job.fatalError = e.message;
    await saveAndNotify(job);
    throw e;
  } finally {
    running = false;
  }
}
export function recorderRange(items = []) {
  const dates = items
    .flatMap((i) => i.dates || [])
    .filter(Boolean)
    .sort();
  if (!dates.length) return {};
  return {
    from: new Date(`${dates[0]}T00:00:00+07:00`).toISOString(),
    to: new Date(
      +new Date(`${dates.at(-1)}T00:00:00+07:00`) + 86400000,
    ).toISOString(),
  };
}
function mergeInputItems(items = []) {
  const map = new Map();
  for (const i of items) {
    const v = map.get(i.url) || { url: i.url, dates: [], targets: {} };
    v.dates = [...new Set([...v.dates, ...(i.dates || [])])].sort();
    for (const [d, s] of Object.entries(i.targets || {}))
      v.targets[d] = [...new Set([...(v.targets[d] || []), ...s])].sort();
    map.set(i.url, v);
  }
  return [...map.values()].sort((a, b) => a.url.localeCompare(b.url));
}
async function saveAndNotify(job) {
  await chrome.storage.local.set({ [STORAGE_KEY]: job });
  chrome.runtime.sendMessage({ type: "JOB_PROGRESS", job }).catch(() => {});
}
// MV3 can terminate the worker mid-request. Recover persisted in-flight work using session-only credentials.
async function recover() {
  const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (data?.status !== "running" || running) return;
  const c = (await chrome.storage.session.get("gitubgenCredentials"))
    .gitubgenCredentials;
  if (c?.githubToken || c?.recorderSecret)
    await startScan(
      data.inputs,
      data.maxDepth,
      c.githubToken,
      { url: c.recorderUrl, secret: c.recorderSecret },
      data.inputContext,
    );
  else {
    data.status = "paused";
    data.fatalError =
      "Masukkan kembali kredensial untuk melanjutkan checkpoint.";
    await saveAndNotify(data);
  }
}
recover().catch(() => {});
