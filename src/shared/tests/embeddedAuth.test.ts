import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { renewEmbeddedSession } from '@/shared/authToken';

const host = { postMessage: vi.fn() };
const proxyPath = '/api/v1/llm4ad/papers/workspaces/workspace/cloudcli/session/existing';

beforeEach(() => {
  vi.useFakeTimers();
  host.postMessage.mockReset();
  vi.stubGlobal('parent', host);
  window.history.replaceState({}, '', proxyPath);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function reply(requestId: string, options: { origin?: string; source?: unknown; success?: boolean } = {}) {
  window.dispatchEvent(new MessageEvent('message', {
    source: (options.source ?? host) as Window,
    origin: options.origin ?? window.location.origin,
    data: { type: 'llm4ad:auth-renewed', requestId, success: options.success ?? true },
  }));
}

test('HTTP and WebSocket recovery share one ticket renewal and validate the host reply', async () => {
  const first = renewEmbeddedSession();
  const second = renewEmbeddedSession();
  expect(first).toBe(second);
  expect(host.postMessage).toHaveBeenCalledTimes(1);
  const message = host.postMessage.mock.calls[0][0];
  expect(message.type).toBe('llm4ad:auth-renew');
  expect(Object.keys(message).sort()).toEqual(['requestId', 'type']);
  let settled = false;
  void first.then(() => { settled = true; });
  reply(message.requestId, { origin: 'https://foreign.invalid' });
  reply(message.requestId, { source: window });
  reply('another-request');
  await Promise.resolve();
  expect(settled).toBe(false);
  reply(message.requestId);
  await Promise.all([first, second]);
  expect(settled).toBe(true);
});

test('timeout cleans up the listener and a later wake can retry', async () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const first = renewEmbeddedSession();
  const rejected = expect(first).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
  const next = renewEmbeddedSession();
  expect(host.postMessage).toHaveBeenCalledTimes(2);
  reply(host.postMessage.mock.calls[1][0].requestId);
  await next;
});

test('host denial rejects without modifying standalone credentials', async () => {
  localStorage.setItem('auth-token', 'standalone-token');
  const pending = renewEmbeddedSession();
  reply(host.postMessage.mock.calls[0][0].requestId, { success: false });
  await expect(pending).rejects.toThrow('renewal failed');
  expect(localStorage.getItem('auth-token')).toBe('standalone-token');
});
