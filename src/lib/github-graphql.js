const ENDPOINT = 'https://api.github.com/graphql';

export const ACTIVITY_QUERY = `
query Activity($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      title url createdAt closedAt
      comments(first: 100) { nodes { createdAt bodyText author { login } } }
      trackedIssues(first: 100) { nodes { url } }
      projectItems(first: 20) {
        nodes { fieldValues(first: 100) { nodes {
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
        } } }
      }
      timelineItems(first: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT, CROSS_REFERENCED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
        nodes {
          ... on ProjectV2ItemStatusChangedEvent {
            __typename createdAt previousStatus status wasAutomated actor { login } project { number title }
          }
          ... on CrossReferencedEvent {
            __typename createdAt actor { login }
            source { ... on Issue { url title } ... on PullRequest { url title } }
          }
          ... on ClosedEvent { __typename createdAt actor { login } }
          ... on ReopenedEvent { __typename createdAt actor { login } }
        }
      }
    }
    pullRequest(number: $number) {
      title url createdAt closedAt mergedAt author { login } mergedBy { login }
      comments(first: 100) { nodes { createdAt bodyText author { login } } }
      reviews(first: 100) { nodes { submittedAt author { login } state } }
      commits(first: 100) {
        nodes { commit { committedDate messageHeadline url author { user { login } } } }
      }
      projectItems(first: 20) {
        nodes { fieldValues(first: 100) { nodes {
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
        } } }
      }
      timelineItems(first: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT, CROSS_REFERENCED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
        nodes {
          ... on ProjectV2ItemStatusChangedEvent {
            __typename createdAt previousStatus status wasAutomated actor { login } project { number title }
          }
          ... on CrossReferencedEvent {
            __typename createdAt actor { login }
            source { ... on Issue { url title } ... on PullRequest { url title } }
          }
          ... on ClosedEvent { __typename createdAt actor { login } }
          ... on ReopenedEvent { __typename createdAt actor { login } }
        }
      }
    }
  }
}`;

export function parseIssueUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], kind: match[3], number: Number(match[4]) };
  } catch {
    return null;
  }
}

const actorLogin = value => value?.login || 'GitHub';

function normalizeTimeline(nodes = [], url) {
  return nodes.filter(Boolean).map(node => {
    if (node.status) {
      const project = node.project?.title ? ` in ${node.project.title}` : '';
      const transition = node.previousStatus
        ? `moved this from ${node.previousStatus} to ${node.status}`
        : `moved this to ${node.status}`;
      return {
        datetime: node.createdAt, type: 'status', text: `${actorLogin(node.actor)} ${transition}${project}`,
        source: 'graphql', previousStatus: node.previousStatus || '', status: node.status,
        actor: actorLogin(node.actor), wasAutomated: Boolean(node.wasAutomated), url
      };
    }
    if (node.source?.url) {
      const isPr = node.source.url.includes('/pull/');
      return {
        datetime: node.createdAt, type: isPr ? 'pull_request' : 'activity',
        text: `${actorLogin(node.actor)} linked a ${isPr ? 'pull request' : 'issue'}: ${node.source.title || node.source.url}`,
        source: 'graphql', actor: actorLogin(node.actor), linkedUrl: node.source.url, url
      };
    }
    if (node.__typename === 'ClosedEvent') return {
      datetime: node.createdAt, type: 'issue_state', text: `${actorLogin(node.actor)} closed this`, source: 'graphql', url
    };
    if (node.__typename === 'ReopenedEvent') return {
      datetime: node.createdAt, type: 'issue_state', text: `${actorLogin(node.actor)} reopened this`, source: 'graphql', url
    };
    return null;
  }).filter(event => event?.datetime);
}

function normalizeComments(nodes = [], url, subject = 'issue') {
  return nodes.filter(node => node?.createdAt).map(node => ({
    datetime: node.createdAt, type: 'comment',
    text: `${actorLogin(node.author)} commented on ${subject}: ${String(node.bodyText || '').trim()}`,
    body: String(node.bodyText || '').trim(), source: 'graphql', actor: actorLogin(node.author), url
  }));
}

function normalizePullRequest(pr, url) {
  if (!pr) return [];
  const events = [{
    datetime: pr.createdAt, type: 'pull_request', text: `${actorLogin(pr.author)} opened pull request for review`,
    source: 'graphql', url
  }];
  for (const node of pr.commits?.nodes || []) {
    const commit = node?.commit;
    if (commit?.committedDate) events.push({
      datetime: commit.committedDate, type: 'commit',
      text: `${actorLogin(commit.author?.user)} committed ${commit.messageHeadline || ''}`.trim(),
      source: 'graphql', actor: actorLogin(commit.author?.user), url
    });
  }
  for (const review of pr.reviews?.nodes || []) if (review?.submittedAt) events.push({
    datetime: review.submittedAt, type: 'review',
    text: `${actorLogin(review.author)} submitted ${String(review.state || '').toLowerCase()} review`,
    source: 'graphql', actor: actorLogin(review.author), url
  });
  events.push(...normalizeComments(pr.comments?.nodes, url, 'pull request'));
  if (pr.mergedAt) events.push({
    datetime: pr.mergedAt, type: 'pull_request', text: `${actorLogin(pr.mergedBy)} merged pull request`, source: 'graphql', url
  });
  else if (pr.closedAt) events.push({
    datetime: pr.closedAt, type: 'issue_state', text: 'GitHub closed this pull request', source: 'graphql', url
  });
  return events.filter(event => event.datetime);
}

function getTargetDate(subject) {
  for (const item of subject?.projectItems?.nodes || []) {
    for (const value of item?.fieldValues?.nodes || []) {
      if (/^target date$/i.test(value?.field?.name || '') && value.date) return value.date;
    }
  }
  return '';
}

export function normalizeActivity(payload, requestedUrl) {
  const repository = payload?.data?.repository;
  const target = parseIssueUrl(requestedUrl);
  const isPullRequest = target?.kind === 'pull';
  const subject = isPullRequest ? repository?.pullRequest : repository?.issue;
  if (!subject) throw new Error('Issue/PR tidak ditemukan atau tidak dapat diakses.');
  const url = subject.url || requestedUrl;
  const events = [
    ...normalizeTimeline(subject.timelineItems?.nodes, url),
    ...normalizeComments(isPullRequest ? [] : subject.comments?.nodes, url),
    ...normalizePullRequest(isPullRequest ? repository.pullRequest : null, url)
  ].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const linkedUrls = [
    ...(subject.trackedIssues?.nodes || []).map(node => node?.url),
    ...events.map(event => event.linkedUrl)
  ].filter((value, index, all) => value && value !== url && all.indexOf(value) === index);
  return {
    ok: true, url, title: subject.title || '', events, linkedUrls,
    targetDate: getTargetDate(subject), collectedAt: new Date().toISOString(), activitySource: 'graphql'
  };
}

export async function fetchActivity(url, token, fetchImpl = fetch) {
  const target = parseIssueUrl(url);
  if (!target) throw new Error('URL issue/PR GitHub tidak valid.');
  if (!token) throw new Error('Token GitHub belum diisi.');
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: ACTIVITY_QUERY, variables: { owner: target.owner, repo: target.repo, number: target.number } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GraphQL GitHub gagal (${response.status}).`);
  if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
  if (!payload.data?.repository) throw new Error('Repository tidak dapat diakses oleh token GitHub.');
  return normalizeActivity(payload, url);
}

export const normalizeStatusHistory = (payload, url) =>
  normalizeActivity(payload, url).events.filter(event => event.type === 'status');

export const fetchStatusHistory = async (url, token, fetchImpl = fetch) =>
  (await fetchActivity(url, token, fetchImpl)).events.filter(event => event.type === 'status');
