import { detectEmbeddedBasePath } from '@/shared/embeddedRuntime';

/**
 * The client's half of the JWT session: parsing, expiry, storage and the two
 * events the auth context listens to.
 *
 * Extracted from api.ts, which is meant to be the endpoint map plus its request
 * helpers. This is the security-sensitive part and it is what WebSocketContext,
 * AuthContext, the shell socket and the file-tree uploader actually import.
 */

export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth-session-expired';

// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
export const isValidRefreshedToken = (token: unknown): token is string =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

type TokenClaims = {
  issuedAt: number;
  expiresAt: number;
};

const readTokenClaims = (token: unknown): TokenClaims | null => {
  if (!isValidRefreshedToken(token)) {
    return null;
  }

  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(
      encodedPayload.length + ((4 - (encodedPayload.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(paddedPayload)) as { iat?: unknown; exp?: unknown };

    if (
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp)
    ) {
      return null;
    }

    return { issuedAt: payload.iat * 1000, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
};

// Tolerance for local expiry hints. Server verification remains authoritative;
// a browser clock running ahead must never revoke a still-valid session.
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export const isAuthTokenExpired = (token: unknown): boolean => {
  const claims = readTokenClaims(token);
  return claims ? Date.now() >= claims.expiresAt + TOKEN_EXPIRY_SKEW_MS : false;
};

export const getAuthTokenRefreshDelay = (token: unknown): number | null => {
  const claims = readTokenClaims(token);
  if (!claims) {
    return null;
  }

  const refreshAt = claims.issuedAt + ((claims.expiresAt - claims.issuedAt) / 2);
  return Math.max(0, refreshAt - Date.now());
};

export const expireAuthSession = (expectedToken?: string | null): void => {
  if (expectedToken !== undefined && localStorage.getItem('auth-token') !== expectedToken) return;
  localStorage.removeItem('auth-token');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
};

export const getStoredAuthToken = (): string | null => {
  // Browser clocks and wake timing are advisory. Only the server revokes a session.
  return localStorage.getItem('auth-token');
};

export const storeAuthToken = (token: unknown, expectedToken?: string | null): boolean => {
  if (!isValidRefreshedToken(token)) {
    return false;
  }
  const currentToken = localStorage.getItem('auth-token');
  if (expectedToken !== undefined && currentToken !== expectedToken) return false;
  if (currentToken === token) return true;

  localStorage.setItem('auth-token', token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: token }));
  }
  return true;
};


// All transports in one iframe share the same host ticket renewal.
let pendingRenewal: Promise<void> | null = null;
let requestSequence = 0;

/** Ask the trusted host to renew its cookie without reloading chat or sending tokens. */
export function renewEmbeddedSession(): Promise<void> {
  if (!detectEmbeddedBasePath() || window.parent === window) return Promise.resolve();
  if (pendingRenewal) return pendingRenewal;
  const requestId = `auth-${Date.now()}-${++requestSequence}`;
  pendingRenewal = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin ||
        event.data?.type !== 'llm4ad:auth-renewed' || event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.success === true) resolve();
      else reject(Object.assign(new Error('Embedded session renewal failed'), { status: event.data.status }));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Embedded session renewal timed out'));
    }, 30_000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'llm4ad:auth-renew', requestId }, window.location.origin);
  }).finally(() => { pendingRenewal = null; });
  return pendingRenewal;
}
