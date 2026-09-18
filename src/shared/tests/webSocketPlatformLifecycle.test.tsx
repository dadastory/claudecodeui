import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { beforeEach, test, vi } from 'vitest';

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

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
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

  send() {}
}

const sockets: FakeWebSocket[] = [];

beforeEach(() => {
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
