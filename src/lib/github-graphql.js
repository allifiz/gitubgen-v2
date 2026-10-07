const ENDPOINT = 'https://api.github.com/graphql';

export const STATUS_HISTORY_QUERY = `
query StatusHistory($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      timelineItems(first: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) {
        nodes {
          ... on ProjectV2ItemStatusChangedEvent {
            createdAt previousStatus status wasAutomated
            actor { login }
            project { number title }
          }
        }
      }
    }
    pullRequest(number: $number) {
      timelineItems(first: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) {
        nodes {
          ... on ProjectV2ItemStatusChangedEvent {
            createdAt previousStatus status wasAutomated
            actor { login }
            project { number title }
          }
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

export function normalizeStatusHistory(payload, url) {
  const repository = payload?.data?.repository;
  const subject = repository?.issue || repository?.pullRequest;
  const nodes = subject?.timelineItems?.nodes || [];
  return nodes.filter(Boolean).map(node => {
    const actor = node.actor?.login || 'GitHub';
    const project = node.project?.title ? ` in ${node.project.title}` : '';
    const transition = node.previousStatus
      ? `moved this from ${node.previousStatus} to ${node.status}`
      : `moved this to ${node.status}`;
    return {
      datetime: node.createdAt,
      type: 'status',
      text: `${actor} ${transition}${project}`,
      source: 'graphql',
      previousStatus: node.previousStatus || '',
      status: node.status,
      actor,
      wasAutomated: Boolean(node.wasAutomated),
      url
    };
  }).filter(event => event.datetime && event.status);
}

export async function fetchStatusHistory(url, token, fetchImpl = fetch) {
  const target = parseIssueUrl(url);
  if (!target) throw new Error('URL issue/PR GitHub tidak valid.');
  if (!token) throw new Error('Token GitHub belum diisi.');
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: STATUS_HISTORY_QUERY,
      variables: { owner: target.owner, repo: target.repo, number: target.number }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GraphQL GitHub gagal (${response.status}).`);
  if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
  if (!payload.data?.repository) throw new Error('Repository tidak dapat diakses oleh token GitHub.');
  return normalizeStatusHistory(payload, url);
}
