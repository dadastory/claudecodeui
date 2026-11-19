import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  current: {
    isLoading: true,
    token: null as string | null,
    user: null as { username: string } | null,
  },
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => authState.current,
}));

vi.mock('@/shared/authToken', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  renewEmbeddedSession: vi.fn(async () => {}),
}));
vi.mock('@/shared/api', () => ({ renewAuthSession: vi.fn(async () => null) }));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCount = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  close() {
    this.closeCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  disconnect(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  send(data: string) { this.sent.push(data); }
}

const sockets: FakeWebSocket[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sockets.length = 0;
  authState.current = { isLoading: true, token: null, user: null };
  vi.stubEnv('VITE_IS_PLATFORM', 'true');
  vi.stubEnv('VITE_LLM4AD_EMBEDDED', 'true');
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.resetModules();
});

test('platform authentication state changes do not replace the active websocket', async () => {
  const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
  const view = render(<WebSocketProvider><span>child</span></WebSocketProvider>);

  assert.equal(sockets.length, 1);
  act(() => sockets[0].open());

  authState.current = {
    isLoading: false,
    token: null,
    user: { username: 'platform-user' },
  };
  view.rerender(<WebSocketProvider><span>child</span></WebSocketProvider>);

  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closeCount, 0);
});

test('the first websocket open notifies subscribers to retry initial subscriptions', async () => {
  const { WebSocketProvider, useWebSocket } = await import('@/shared/context/WebSocketContext');
  const eventKinds: Array<string | undefined> = [];

  function Probe() {
    const { subscribe } = useWebSocket();
    useEffect(() => subscribe((event) => eventKinds.push(event.kind)), [subscribe]);
    return null;
  }

  render(<WebSocketProvider><Probe /></WebSocketProvider>);
  act(() => sockets[0].open());

  assert.deepEqual(eventKinds, ['websocket_connected']);
});

test('sending uses the socket ready state even when a wrapper omits constructor constants', async () => {
  const { WebSocketProvider, useWebSocket } = await import('@/shared/context/WebSocketContext');
  const sendMessageRef: { current?: (message: unknown) => boolean } = {};

  function Probe() {
    sendMessageRef.current = useWebSocket().sendMessage;
    return null;
  }

  render(<WebSocketProvider><Probe /></WebSocketProvider>);
  act(() => sockets[0].open());

  assert.equal(sendMessageRef.current?.({ type: 'ping' }), true);
});


afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('simultaneous wake events recover one closed socket without replaying commands', async () => {
  const { WebSocketProvider, useWebSocket } = await import('@/shared/context/WebSocketContext');
  const kinds: Array<string | undefined> = [];
  function Probe() {
    const { subscribe } = useWebSocket();
    useEffect(() => subscribe((event) => kinds.push(event.kind)), [subscribe]);
    return null;
  }
  const view = render(<WebSocketProvider><Probe /></WebSocketProvider>);
  const old = sockets[0];
  const staleMessage = old.onmessage;
  const staleOpen = old.onopen;
  const staleClose = old.onclose;
  act(() => { old.open(); old.disconnect(4401); });
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));
  });
  assert.equal(sockets.length, 2);
  act(() => {
    sockets[1].open();
    staleMessage?.(new MessageEvent('message', { data: '{"kind":"duplicate"}' }));
    staleOpen?.();
    staleClose?.({ code: 1006 });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  assert.equal(sockets.length, 2);
  assert.deepEqual(kinds, ['websocket_connected', 'websocket_connected']);
  assert.deepEqual(sockets.flatMap((socket) => socket.sent), []);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  assert.equal(sockets.length, 2);
});

test('a long browser sleep replaces a half-open connection once on visibility wake', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
  render(<WebSocketProvider><span /></WebSocketProvider>);
  act(() => sockets[0].open());
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  assert.equal(sockets.length, 1);
  visibility.mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  assert.equal(sockets[0].closeCount, 1);
  assert.equal(sockets.length, 2);
});

test('standalone token rotation keeps an open socket and reconnect uses the current token', async () => {
  vi.stubEnv('VITE_IS_PLATFORM', 'false');
  authState.current = { isLoading: false, token: 'old-token', user: { username: 'user' } };
  localStorage.setItem('auth-token', 'old-token');
  const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
  const view = render(<WebSocketProvider><span /></WebSocketProvider>);
  act(() => sockets[0].open());
  localStorage.setItem('auth-token', 'new-token');
  authState.current = { ...authState.current, token: 'new-token' };
  view.rerender(<WebSocketProvider><span /></WebSocketProvider>);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closeCount, 0);
  act(() => sockets[0].disconnect());
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  assert.equal(sockets.length, 2);
  assert.ok(sockets[1].url.endsWith('?token=new-token'));
});

test('offline reconnect attempts are suspended until online and bounded after repeated failures', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
  render(<WebSocketProvider><span /></WebSocketProvider>);
  assert.equal(sockets.length, 0);
  online.mockReturnValue(true);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  for (let i = 0; i < 7; i += 1) {
    act(() => sockets[sockets.length - 1].disconnect());
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  }
  assert.equal(sockets.length, 6);
});

test('a renewal finishing after the tab is hidden cannot reopen a background socket', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { renewEmbeddedSession } = await import('@/shared/authToken');
  let finish!: () => void;
  vi.mocked(renewEmbeddedSession).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { WebSocketProvider } = await import('@/shared/context/WebSocketContext');
  render(<WebSocketProvider><span /></WebSocketProvider>);
  act(() => { sockets[0].open(); sockets[0].disconnect(); });
  act(() => window.dispatchEvent(new Event('focus')));
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => finish());
  assert.equal(sockets.length, 1);
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(sockets.length, 2);
});
