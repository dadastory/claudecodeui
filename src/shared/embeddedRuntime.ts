const EMBEDDED_ROUTE_SEGMENT = '/cloudcli';

/** Return the reverse-proxy prefix used by an embedded LLM4AD runtime. */
export function detectEmbeddedBasePath(pathname = window.location.pathname): string {
  const markerIndex = pathname.indexOf(EMBEDDED_ROUTE_SEGMENT);
  if (markerIndex < 0) {
    return '';
  }

  return pathname.slice(0, markerIndex + EMBEDDED_ROUTE_SEGMENT.length).replace(/\/+$/, '');
}

/** Resolve a root-relative HTTP path against the current embedded runtime. */
export function resolveEmbeddedHttpUrl(url: string): string {
  if (!url.startsWith('/')) {
    return url;
  }
  const basePath = detectEmbeddedBasePath();
  if (!basePath || url === basePath || url.startsWith(`${basePath}/`)) {
    return url;
  }
  return `${basePath}${url}`;
}

/** Resolve a root-relative WebSocket path against the current embedded runtime. */
export function resolveEmbeddedWebSocketPath(path: string): string {
  return resolveEmbeddedHttpUrl(path);
}
