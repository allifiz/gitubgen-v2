export function normalizeGitHubUrl(value = '') {
  try {
    const url = new URL(value);
    if (url.hostname !== 'github.com') return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
    if (!match) return null;
    return `https://github.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
  } catch {
    return null;
  }
}

export function issueIdentity(value = '') {
  const normalized = normalizeGitHubUrl(value);
  if (!normalized) return null;
  const [, owner, repo, kind, number] = new URL(normalized).pathname.split('/');
  return { owner, repo, kind, number: Number(number), url: normalized };
}
