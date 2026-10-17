const ENDPOINT = "https://api.github.com/graphql";
const PAGE = "pageInfo { hasNextPage endCursor }";
const timeline = `nodes {
  ... on CrossReferencedEvent { id __typename createdAt actor { login } source { ... on Issue { url title } ... on PullRequest { url title } } }
  ... on ConnectedEvent { id __typename createdAt actor { login } source { ... on Issue { url title } ... on PullRequest { url title } } subject { ... on Issue { url title } ... on PullRequest { url title } } }
  ... on DisconnectedEvent { id __typename createdAt actor { login } source { ... on Issue { url title } ... on PullRequest { url title } } subject { ... on Issue { url title } ... on PullRequest { url title } } }
  ... on ClosedEvent { id __typename createdAt actor { login } closer { ... on PullRequest { url title } } }
  ... on ReopenedEvent { id __typename createdAt actor { login } }
  ... on AssignedEvent { id __typename createdAt actor { login } assignee { ... on User { login } } }
  ... on UnassignedEvent { id __typename createdAt actor { login } assignee { ... on User { login } } }
}`;
const statusTimeline = `nodes { ... on ProjectV2ItemStatusChangedEvent {
  id __typename createdAt previousStatus status wasAutomated actor { login } project { id number title }
} }`;
const fields = {
  comments: (after) =>
    `comments(first:100${after}) { ${PAGE} nodes { id createdAt bodyText author { login } } }`,
  trackedIssues: (after) =>
    `trackedIssues(first:100${after}) { ${PAGE} nodes { id url } }`,
  subIssues: (after) =>
    `subIssues(first:100${after}) { ${PAGE} nodes { id url } }`,
  closedByPullRequestsReferences: (after) =>
    `closedByPullRequestsReferences(first:100,includeClosedPrs:true${after}) { ${PAGE} nodes { id url title } }`,
  timelineItems: (after) =>
    `timelineItems(first:100${after},itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT,DISCONNECTED_EVENT,CLOSED_EVENT,REOPENED_EVENT,ASSIGNED_EVENT,UNASSIGNED_EVENT]) { ${PAGE} ${timeline} }`,
  reviews: (after) =>
    `reviews(first:100${after}) { ${PAGE} nodes { id submittedAt author { login } state } }`,
  commits: (after) =>
    `commits(first:100${after}) { ${PAGE} nodes { commit { oid committedDate messageHeadline url author { user { login } } } } }`,
  statusTimeline: (after) =>
    `timelineItems(first:100${after},itemTypes:[PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) { ${PAGE} ${statusTimeline} }`,
  projectItems: (after) =>
    `projectItems(first:100${after}) { ${PAGE} nodes { id project { id number } fieldValues(first:100) { ${PAGE} nodes { ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { id name } } } } } } }`,
};
const issueFields = [
  "comments",
  "trackedIssues",
  "subIssues",
  "closedByPullRequestsReferences",
  "timelineItems",
];
const prFields = ["comments", "reviews", "commits", "timelineItems"];
const head =
  "id title url createdAt closedAt assignees(first:100) { nodes { login } pageInfo { hasNextPage } }";
const wrap = (name, issue, pr) =>
  `query ${name}($owner:String!,$repo:String!,$number:Int!,$isIssue:Boolean!,$isPullRequest:Boolean!){repository(owner:$owner,name:$repo){issue(number:$number) @include(if:$isIssue){${issue}} pullRequest(number:$number) @include(if:$isPullRequest){${pr}}}}`;
export const ACTIVITY_QUERY = wrap(
  "Activity",
  `${head} ${issueFields.map((f) => fields[f]("")).join(" ")}`,
  `${head} mergedAt author { login } mergedBy { login } ${prFields.map((f) => fields[f]("")).join(" ")}`,
);
export const PROJECT_ACTIVITY_QUERY = wrap(
  "ProjectActivity",
  `id title url ${fields.projectItems("")} ${fields.statusTimeline("")}`,
  `id title url ${fields.projectItems("")} ${fields.statusTimeline("")}`,
);
export function parseIssueUrl(value) {
  try {
    const u = new URL(value),
      m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/);
    return u.hostname === "github.com" && m
      ? { owner: m[1], repo: m[2], kind: m[3], number: Number(m[4]) }
      : null;
  } catch {
    return null;
  }
}
const login = (v) => v?.login || "GitHub";
function normalizeTimeline(nodes = [], url) {
  return nodes
    .filter(Boolean)
    .map((n) => {
      const common = {
        id: n.id,
        datetime: n.createdAt,
        source: "graphql",
        actor: login(n.actor),
        url,
      };
      if (
        n.__typename === "ProjectV2ItemStatusChangedEvent" ||
        n.status != null
      )
        return {
          ...common,
          type: "status",
          previousStatus: n.previousStatus ?? null,
          status: n.status ?? "No status",
          projectId: n.project?.id,
          projectNumber: n.project?.number,
          projectScopeUnknown: !n.project?.number,
          wasAutomated: !!n.wasAutomated,
          text: `${login(n.actor)} moved this${n.previousStatus ? ` from ${n.previousStatus}` : ""} to ${n.status || "No status"}`,
        };
      if (["AssignedEvent", "UnassignedEvent"].includes(n.__typename))
        return {
          ...common,
          type: "assignment",
          action: n.__typename === "AssignedEvent" ? "assigned" : "unassigned",
          assignee: n.assignee?.login,
          text: `${n.__typename}: ${n.assignee?.login || "unknown"}`,
        };
      const linked = [n.source, n.subject, n.closer].find(
        (s) => s?.url && s.url !== url,
      );
      if (n.__typename === "ClosedEvent")
        return {
          ...common,
          type: "issue_state",
          state: "closed",
          linkedUrl: linked?.url,
          relationshipType: "closing_pr",
          text: `${login(n.actor)} closed this`,
        };
      if (linked?.url)
        return {
          ...common,
          type: "relationship",
          linkedUrl: linked.url,
          relationshipType:
            n.__typename === "DisconnectedEvent"
              ? "disconnected"
              : n.__typename === "CrossReferencedEvent"
                ? "mention"
                : "connected",
          text: `${n.__typename}: ${linked.title || linked.url}`,
        };
      if (["ClosedEvent", "ReopenedEvent"].includes(n.__typename))
        return {
          ...common,
          type: "issue_state",
          state: n.__typename === "ClosedEvent" ? "closed" : "open",
          text: `${login(n.actor)} ${n.__typename === "ClosedEvent" ? "closed" : "reopened"} this`,
        };
      return null;
    })
    .filter((e) => e?.datetime);
}
function comments(nodes = [], url) {
  return nodes
    .filter((n) => n?.createdAt)
    .map((n) => ({
      id: n.id,
      datetime: n.createdAt,
      type: "comment",
      body: String(n.bodyText || "").trim(),
      text: `${login(n.author)} commented: ${n.bodyText || ""}`,
      source: "graphql",
      actor: login(n.author),
      url,
    }));
}
function prEvents(pr, url) {
  if (!pr) return [];
  const out = [
    {
      id: `${pr.id}:opened`,
      datetime: pr.createdAt,
      type: "pull_request",
      text: `${login(pr.author)} opened pull request for review`,
      source: "graphql",
      actor: login(pr.author),
      url,
    },
  ];
  for (const n of pr.commits?.nodes || []) {
    const c = n?.commit;
    if (c?.committedDate)
      out.push({
        id: c.oid || c.url,
        datetime: c.committedDate,
        type: "commit",
        text: `${login(c.author?.user)} committed ${c.messageHeadline || ""}`,
        source: "graphql",
        actor: login(c.author?.user),
        url,
        commitUrl: c.url,
      });
  }
  for (const r of pr.reviews?.nodes || [])
    if (r?.submittedAt)
      out.push({
        id: r.id,
        datetime: r.submittedAt,
        type: "review",
        text: `${login(r.author)} submitted ${r.state} review`,
        source: "graphql",
        url,
      });
  if (pr.mergedAt)
    out.push({
      id: `${pr.id}:merged`,
      datetime: pr.mergedAt,
      type: "merge",
      text: `${login(pr.mergedBy)} merged pull request`,
      source: "graphql",
      url,
    });
  return out.filter((e) => e.datetime);
}
export function normalizeActivity(payload, requestedUrl, options = {}) {
  const target = parseIssueUrl(requestedUrl),
    s =
      payload?.data?.repository?.[
        target?.kind === "pull" ? "pullRequest" : "issue"
      ];
  if (!s) throw new Error("Issue/PR tidak ditemukan atau tidak dapat diakses.");
  const url = s.url || requestedUrl,
    events = [
      ...normalizeTimeline(s.timelineItems?.nodes, url),
      ...comments(s.comments?.nodes, url),
      ...prEvents(target?.kind === "pull" ? s : null, url),
    ].sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime));
  const relationships = [];
  for (const [field, type] of [
    ["trackedIssues", "sub_issue"],
    ["subIssues", "sub_issue"],
    ["closedByPullRequestsReferences", "closing_pr"],
  ])
    for (const n of s[field]?.nodes || [])
      if (n?.url) relationships.push({ url: n.url, type });
  for (const e of events)
    if (e.linkedUrl)
      relationships.push({ url: e.linkedUrl, type: e.relationshipType });
  const disconnected = new Set(
    relationships.filter((r) => r.type === "disconnected").map((r) => r.url),
  );
  const relations = [
    ...new Map(
      relationships
        .filter((r) => r.url !== url && !disconnected.has(r.url))
        .map((r) => [`${r.type}|${r.url}`, r]),
    ).values(),
  ];
  let targetDate = "";
  for (const item of s.projectItems?.nodes || [])
    if (item?.project?.number === (options.projectNumber || 11))
      for (const v of item.fieldValues?.nodes || [])
        if (/^target date$/i.test(v?.field?.name || "") && v.date)
          targetDate = v.date;
  return {
    ok: true,
    url,
    issueNodeId: s.id,
    title: s.title || "",
    assignees: (s.assignees?.nodes || []).map((n) => n.login),
    events,
    relationships: relations,
    linkedUrls: [
      ...new Set(
        relations.filter((r) => r.type !== "mention").map((r) => r.url),
      ),
    ],
    targetDate,
    collectedAt: new Date().toISOString(),
    activitySource: "graphql",
  };
}
export async function fetchActivity(
  url,
  token,
  fetchImpl = fetch,
  options = {},
) {
  const t = parseIssueUrl(url);
  if (!t) throw new Error("URL issue/PR GitHub tidak valid.");
  if (!token) throw new Error("Token GitHub belum diisi.");
  const variables = {
      owner: t.owner,
      repo: t.repo,
      number: t.number,
      isIssue: t.kind === "issues",
      isPullRequest: t.kind === "pull",
    },
    key = t.kind === "pull" ? "pullRequest" : "issue",
    warnings = [];
  let requests = 0;
  const rateLimits = [];
  const limit = options.maxRequests || 40;
  async function request(query, vars) {
    if (++requests > limit) throw new Error("REQUEST_BUDGET_REACHED");
    const payload = await fetchGraphql(
      query,
      vars,
      token,
      fetchImpl,
      options.budget,
    );
    if (payload._rateLimit) rateLimits.push(payload._rateLimit);
    return payload;
  }
  async function collect(query, connections) {
    const payload = await request(query, variables);
    warnings.push(...errorMessages(payload));
    const subject = payload.data?.repository?.[key];
    if (!subject) return null;
    for (const field of connections) {
      const name = field === "statusTimeline" ? "timelineItems" : field;
      let conn = subject[name];
      let cursor = conn?.pageInfo?.endCursor;
      while (conn?.pageInfo?.hasNextPage) {
        if (!cursor || !subject.id) {
          warnings.push(`PARTIAL_${field}`);
          break;
        }
        try {
          const q = `query Page($id:ID!,$after:String!){node(id:$id){... on ${t.kind === "pull" ? "PullRequest" : "Issue"}{${fields[field](",after:$after")}}}}`;
          const page = await request(q, { id: subject.id, after: cursor });
          warnings.push(...errorMessages(page));
          const next = page.data?.node?.[name];
          if (!next || next.pageInfo?.endCursor === cursor) {
            warnings.push(`PARTIAL_${field}`);
            break;
          }
          subject[name].nodes.push(...(next.nodes || []));
          conn = next;
          cursor = next.pageInfo?.endCursor;
        } catch (e) {
          warnings.push(`${field}: ${e.message}`);
          break;
        }
      }
    }
    if (subject.assignees?.pageInfo?.hasNextPage)
      warnings.push("PARTIAL_ASSIGNEES");
    if (
      subject.projectItems?.nodes?.some(
        (n) => n.fieldValues?.pageInfo?.hasNextPage,
      )
    )
      warnings.push("PARTIAL_PROJECT_FIELDS");
    return normalizeActivity(payload, url, options);
  }
  let core, project;
  try {
    core = await collect(
      ACTIVITY_QUERY,
      t.kind === "pull" ? prFields : issueFields,
    );
  } catch (e) {
    warnings.push(e.message);
  }
  try {
    project = await collect(PROJECT_ACTIVITY_QUERY, [
      "projectItems",
      "statusTimeline",
    ]);
  } catch (e) {
    warnings.push(e.message);
  }
  if (!core && !project)
    throw new Error(
      warnings.join("; ") ||
        "Repository tidak dapat diakses oleh token GitHub.",
    );
  const scan = {
    ...(core || project),
    events: [...(core?.events || []), ...(project?.events || [])].sort(
      (a, b) => +new Date(a.datetime) - +new Date(b.datetime),
    ),
    targetDate: project?.targetDate || core?.targetDate || "",
    warnings,
    coverage: {
      complete: !!core && !!project && !warnings.length,
      core: !!core,
      project: !!project,
      requests,
      maxRequests: limit,
      rateLimits,
    },
    activitySource: warnings.length ? "graphql-partial" : "graphql",
  };
  return scan;
}
async function fetchGraphql(query, variables, token, fetchImpl, budget) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budget) {
      if (budget.used >= budget.limit)
        throw new Error("GLOBAL_REQUEST_BUDGET_REACHED");
      budget.used++;
    }
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (e) {
      if (attempt) throw e;
      continue;
    }
    if (response.status >= 500 && attempt === 0) continue;
    break;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `GraphQL GitHub gagal (${response.status}); remaining=${response.headers?.get?.("x-ratelimit-remaining") ?? "unknown"}.`,
    );
  if (response.headers?.get)
    payload._rateLimit = {
      remaining: response.headers.get("x-ratelimit-remaining"),
      limit: response.headers.get("x-ratelimit-limit"),
      reset: response.headers.get("x-ratelimit-reset"),
    };
  return payload;
}
function errorMessages(p) {
  return (p.errors || []).map((e) => e.message).filter(Boolean);
}
export const normalizeStatusHistory = (payload, url) =>
  normalizeActivity(payload, url).events.filter((e) => e.type === "status");
export const fetchStatusHistory = async (url, token, fetchImpl = fetch) =>
  (await fetchActivity(url, token, fetchImpl)).events.filter(
    (e) => e.type === "status",
  );
