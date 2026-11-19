import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';

/**
 * The consumer side of the JWT lifecycle that authToken.ts owns.
 * authToken.test.ts covers the primitives; nothing covered the request helper
 * that calls them on every API call in the app.
 *
 * IS_PLATFORM is resolved at module scope from a build-time flag and decides
 * whether the app authenticates with a bearer token at all, so each test loads
 * a fresh copy of api.ts with the flag stubbed. Reading the ambient value would
 * make these tests agree with whatever .env the machine happens to have — this
 * workspace has VITE_IS_PLATFORM=true, CI does not.
 */

const loadFetch = async (isPlatform: boolean) => {
  vi.stubEnv('VITE_IS_PLATFORM', isPlatform ? 'true' : 'false');
  vi.resetModules();
  return (await import('@/shared/api')).authenticatedFetch;
};

const makeToken = (payload: Record<string, unknown>) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

const liveToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ iat: now, exp: now + 600 });
};

const expiredToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ iat: now - 7200, exp: now - 3600 });
};

let lastInit: RequestInit | undefined;

const respondWith = (headers: Record<string, string> = {}) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    lastInit = init;
    return new Response('{}', { status: 200, headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const sentHeaders = () => (lastInit?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  lastInit = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('a live token is sent as a bearer credential', async () => {
  const token = liveToken();
  localStorage.setItem('auth-token', token);
  respondWith();

  await (await loadFetch(false))('/api/projects');

  assert.equal(sentHeaders().Authorization, `Bearer ${token}`);
});

test('platform builds send no bearer token, because the session is a cookie', async () => {
  const token = liveToken();
  localStorage.setItem('auth-token', token);
  respondWith();

  await (await loadFetch(true))('/api/projects');

  assert.equal('Authorization' in sentHeaders(), false);
});

test('local expiry alone does not log out a session before server verification', async () => {
  const token = expiredToken();
  localStorage.setItem('auth-token', token);
  let expiries = 0;
  const onExpired = () => {
    expiries += 1;
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  respondWith();

  await (await loadFetch(false))('/api/projects');

  window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  assert.equal(sentHeaders().Authorization, `Bearer ${token}`);
  assert.equal(localStorage.getItem('auth-token'), token);
  assert.equal(expiries, 0);
});

test('no token means no Authorization header at all', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects');

  assert.equal('Authorization' in sentHeaders(), false);
});

test('a JSON body is labelled as JSON', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects', { method: 'POST', body: '{"a":1}' });

  assert.equal(sentHeaders()['Content-Type'], 'application/json');
});

test('a FormData body is left for the browser to label', async () => {
  // Setting Content-Type by hand drops the multipart boundary and the upload
  // arrives unparseable.
  respondWith();

  await (await loadFetch(false))('/api/upload', { method: 'POST', body: new FormData() });

  assert.equal('Content-Type' in sentHeaders(), false);
});

test('a caller header wins over the default', async () => {
  respondWith();

  await (await loadFetch(false))('/api/projects', {
    method: 'POST',
    body: 'raw',
    headers: { 'Content-Type': 'text/plain' },
  });

  assert.equal(sentHeaders()['Content-Type'], 'text/plain');
});

test('a refreshed token on the response replaces the stored one', async () => {
  localStorage.setItem('auth-token', liveToken());
  const rotated = liveToken().replace('signature', 'rotated');
  let announced: string | null = null;
  const onRefresh = (event: Event) => {
    announced = (event as CustomEvent<string>).detail;
  };
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  respondWith({ 'X-Refreshed-Token': rotated });

  await (await loadFetch(false))('/api/projects');

  window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, onRefresh);
  assert.equal(localStorage.getItem('auth-token'), rotated);
  assert.equal(announced, rotated);
});

test('an auth error on the response ends the session', async () => {
  localStorage.setItem('auth-token', liveToken());
  let expiries = 0;
  const onExpired = () => {
    expiries += 1;
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401, headers: { 'X-Auth-Error': 'invalid' } })));

  await (await loadFetch(false))('/api/projects');

  window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onExpired);
  assert.equal(expiries, 1);
  assert.equal(localStorage.getItem('auth-token'), null);
});

test('an ordinary response leaves the stored token alone', async () => {
  const token = liveToken();
  localStorage.setItem('auth-token', token);
  respondWith();

  await (await loadFetch(false))('/api/projects');

  assert.equal(localStorage.getItem('auth-token'), token);
});


test('platform requests ignore stale standalone tokens and their auth headers', async () => {
  localStorage.setItem('auth-token', expiredToken());
  respondWith({ 'X-Auth-Error': 'invalid' });
  const fetchAuth = await loadFetch(true);
  await fetchAuth('/api/projects');
  assert.ok(localStorage.getItem('auth-token'));
});

test('late standalone 401s cannot discard a newer session', async () => {
  const old = liveToken();
  const rotated = old.replace('signature', 'rotated');
  localStorage.setItem('auth-token', old);
  const fetchAuth = await loadFetch(false);
  vi.stubGlobal('fetch', vi.fn(async () => {
    localStorage.setItem('auth-token', rotated);
    return new Response('{}', { status: 401, headers: { 'X-Auth-Error': 'invalid-token' } });
  }));
  await fetchAuth('/api/projects');
  assert.equal(localStorage.getItem('auth-token'), rotated);
});

test('concurrent standalone refresh calls share one renewal request', async () => {
  localStorage.setItem('auth-token', liveToken());
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: liveToken() })));
  vi.stubGlobal('fetch', fetchMock);
  const { renewAuthSession } = await import('@/shared/api');
  await Promise.all([renewAuthSession(), renewAuthSession(), renewAuthSession()]);
  assert.equal(fetchMock.mock.calls.length, 1);
});

test('a network error never replays a submitted request or clears the standalone session', async () => {
  localStorage.setItem('auth-token', liveToken());
  const fetchAuth = await loadFetch(false);
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', fetchMock);
  await assert.rejects(fetchAuth('/api/send', { method: 'POST', body: 'prompt' }), /offline/);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.ok(localStorage.getItem('auth-token'));
});

test('concurrent embedded 401s renew only the host cookie and retry each rejected request once', async () => {
  const fetchAuth = await loadFetch(true);
  window.history.replaceState({}, '', '/api/v1/llm4ad/papers/workspaces/id/cloudcli/session/session');
  const host = { postMessage: vi.fn() };
  vi.stubGlobal('parent', host);
  let calls = 0;
  const fetchMock = vi.fn(async () => new Response('{}', { status: ++calls <= 2 ? 401 : 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const requests = [fetchAuth('/api/one'), fetchAuth('/api/two')];
  await vi.waitFor(() => assert.equal(host.postMessage.mock.calls.length, 1));
  window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin,
    source: host as unknown as Window,
    data: { type: 'llm4ad:auth-renewed', requestId: host.postMessage.mock.calls[0][0].requestId, success: true },
  }));
  const responses = await Promise.all(requests);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(fetchMock.mock.calls.length, 4);
  window.history.replaceState({}, '', '/');
});
