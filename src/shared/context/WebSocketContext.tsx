import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/modules/auth';
import { IS_PLATFORM } from '@/shared/utils';
import { getAuthTokenRefreshDelay, getStoredAuthToken, renewEmbeddedSession } from '@/shared/authToken';
import { renewAuthSession } from '@/shared/api';
import type { ServerEvent } from '@/shared/types';
import { resolveEmbeddedWebSocketPath } from '@/shared/embeddedRuntime';


type ServerEventListener = (event: ServerEvent) => void;
const OPEN_READY_STATE = 1;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames cannot be coalesced or
   * dropped. Frames are deliberately not copied into React state; each
   * listener updates only the state owned by the feature that handles it.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}${resolveEmbeddedWebSocketPath('/ws')}`;
  }
  if (!token) return null;
  return `${protocol}//${window.location.host}${resolveEmbeddedWebSocketPath('/ws')}?token=${encodeURIComponent(token)}`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  // Subscribers survive transport replacement and keep their replay cursors.
  const listenersRef = useRef(new Set<ServerEventListener>());
  // Connectivity is the only rendered transport state; tokens are read at handshake.
  const [isConnected, setIsConnected] = useState(false);
  const { isLoading: isAuthLoading, user } = useAuth();
  const canConnect = IS_PLATFORM || (!isAuthLoading && Boolean(user));

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (!canConnect) { setIsConnected(false); return; }
    let active = true;
    let connecting = false;
    let attempts = 0;
    let generation = 0;
    let hiddenAt: number | null = null;
    let wasOffline = false;
    let reconnectTimer: number | undefined;
    let handshakeTimer: number | undefined;

    const canUseTransport = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const detach = () => {
      window.clearTimeout(handshakeTimer);
      const socket = wsRef.current;
      wsRef.current = null;
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
    const scheduleReconnect = () => {
      window.clearTimeout(reconnectTimer);
      if (!active || !canUseTransport() || attempts >= 5) return;
      reconnectTimer = window.setTimeout(() => { void connect(true); }, Math.min(1_000 * 2 ** attempts++, 15_000));
    };
    const connect = async (recover = false) => {
      if (!active || connecting || wsRef.current || !canUseTransport()) return;
      connecting = true;
      const startedGeneration = generation;
      try {
        if (recover && IS_PLATFORM) await renewEmbeddedSession();
        if (!IS_PLATFORM && getAuthTokenRefreshDelay(getStoredAuthToken()) === 0) await renewAuthSession();
        if (!active || generation !== startedGeneration || !canUseTransport()) return;
        const wsUrl = buildWebSocketUrl(IS_PLATFORM ? null : getStoredAuthToken());
        if (!wsUrl) return;
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;
        handshakeTimer = window.setTimeout(() => {
          if (!active || wsRef.current !== socket || socket.readyState === OPEN_READY_STATE) return;
          detach();
          setIsConnected(false);
          scheduleReconnect();
        }, 15_000);
        socket.onopen = () => {
          if (!active || wsRef.current !== socket) return;
          window.clearTimeout(handshakeTimer);
          attempts = 0;
          setIsConnected(true);
          // Consumers resubscribe with their sequence cursor. Never resend chat.send or chat.abort.
          dispatch({ kind: 'websocket_connected', timestamp: Date.now() });
        };
        socket.onmessage = (event) => {
          if (!active || wsRef.current !== socket) return;
          try { dispatch(JSON.parse(event.data) as ServerEvent); }
          catch (error) { console.error('Error parsing WebSocket message:', error); }
        };
        socket.onclose = (event) => {
          if (!active || wsRef.current !== socket) return;
          window.clearTimeout(handshakeTimer);
          wsRef.current = null;
          setIsConnected(false);
          // Handshake failures can be offline or an expired host cookie, not a revoked JWT.
          if (event.code !== 4404) scheduleReconnect();
        };
        socket.onerror = () => {
          // The browser emits close after a failed handshake; it owns retry scheduling.
        };
      } catch (error) {
        console.warn('[WebSocket] Recovery unavailable:', error);
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    };
    const wake = () => {
      if (!active || !canUseTransport()) return;
      const stale = wasOffline || (hiddenAt !== null && Date.now() - hiddenAt > 60_000);
      hiddenAt = null;
      wasOffline = false;
      attempts = 0;
      window.clearTimeout(reconnectTimer);
      if (stale && wsRef.current) {
        // A sleeping browser can still report OPEN on a dead TCP connection.
        generation += 1;
        detach();
        setIsConnected(false);
      }
      if (!wsRef.current) void connect(true);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        window.clearTimeout(reconnectTimer);
      } else wake();
    };
    const offline = () => { wasOffline = true; window.clearTimeout(reconnectTimer); };
    const events = ['focus', 'pageshow', 'online'] as const;
    for (const event of events) window.addEventListener(event, wake);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visibilityChanged);
    void connect();
    return () => {
      active = false;
      generation += 1;
      window.clearTimeout(reconnectTimer);
      detach();
    };
  }, [canConnect, dispatch]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === OPEN_READY_STATE) {
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('WebSocket send failed:', error);
        return false;
      }
    }
    console.warn('WebSocket not connected', {
      hasSocket: Boolean(socket),
      readyState: socket?.readyState ?? null,
      openState: OPEN_READY_STATE,
    });
    return false;
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    subscribe,
    isConnected
  }), [sendMessage, subscribe, isConnected]);

  return value;
};

/** Mounted once by App; owns the single chat websocket that the chat, project-workspace and task-master modules subscribe to. */
export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
