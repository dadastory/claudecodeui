const ALLOWED_API_PREFIXES = [
  '/api/auth',
  '/api/notifications',
  '/api/projects',
  '/api/providers',
  '/api/user',
];

/** Return whether an HTTP path belongs to the restricted research workspace. */
export function isEmbeddedHttpPathAllowed(pathname: string, method = 'GET'): boolean {
  if (pathname === '/health') {
    return true;
  }
  if (pathname.startsWith('/internal/')) {
    return false;
  }
  if (!pathname.startsWith('/api/')) {
    return !pathname.startsWith('/shell');
  }

  const prefixAllowed = ALLOWED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!prefixAllowed) {
    return false;
  }
  if (pathname === '/api/projects' || pathname.startsWith('/api/projects/')) {
    return method === 'GET';
  }
  if (pathname === '/api/providers' || pathname.startsWith('/api/providers/')) {
    if (method === 'POST') {
      return pathname === '/api/providers/sessions';
    }
    if (method !== 'GET') {
      return false;
    }
    return (
      pathname === '/api/providers/capabilities' ||
      pathname === '/api/providers/sessions' ||
      /^\/api\/providers\/[^/]+\/(?:auth\/status|models|skills)(?:\/|$)/.test(pathname) ||
      /^\/api\/providers\/[^/]+\/mcp\/servers(?:\/|$)/.test(pathname) ||
      /^\/api\/providers\/sessions\/(?:archived|running|recent)(?:\/|$)/.test(pathname) ||
      /^\/api\/providers\/sessions\/[^/]+(?:\/(?:messages|provider-id|token-usage))?$/.test(pathname) ||
      /^\/api\/providers\/[^/]+\/sessions\/[^/]+\/active-model$/.test(pathname)
    );
  }
  return true;
}
