import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * The transcript's scroll position is written from five places coordinated by
 * refs and timers rather than by one owner. These are the two cases where that
 * coordination was observably wrong; both are timing bugs, so they are driven
 * on fake timers rather than by clicking.
 */

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

const buildMessage = (index: number, timestamp: string): NormalizedMessage => ({
  id: `m-${index}`,
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: SESSION_A,
  content: `message ${index}`,
  timestamp,
} as NormalizedMessage);

/**
 * Simulates a scroll gesture the way the browser delivers one: the container's
 * scrollTop changes first, then a `scroll` event fires and the handler reads it.
 *
 * Placement matters as much as the value. Auto-follow keys on how far the
 * viewport is from the bottom, so a test that only flips a state flag describes
 * a viewport that never moved — which is exactly the case the production code
 * is entitled to ignore.
 */
function simulateUserScroll(container: ReturnType<typeof createContainer>, scrollTop: number) {
  container.setScrollTop(scrollTop);
  container.element.dispatchEvent(new Event('scroll'));
}

/**
 * Points the hook at a container and lets the commit settle.
 *
 * The listener is attached by an effect, and the fixture assigns the ref after
 * the render that created it, so dispatching a scroll before this second commit
 * reaches nothing — the hook would look inert against a scroll it never saw.
 */
async function mountContainer(
  result: { current: { scrollContainerRef: { current: HTMLDivElement | null } } },
  rerender: (props: { session: ProjectSession }) => void,
  container: ReturnType<typeof createContainer>,
  sessionId: string,
) {
  result.current.scrollContainerRef.current = container.element;
  await act(async () => {
    rerender({ session: { id: sessionId } as ProjectSession });
  });
}

/**
 * jsdom has no layout, so scrollHeight/clientHeight are always 0 and assigning
 * scrollTop emits nothing. These are the exact reads the scroll code makes.
 *
 * `setScrollTop` stands in for the browser moving the viewport, and
 * `setScrollHeight` for content arriving underneath it — including the case
 * where content grows *after* the user has already scrolled up, which is what a
 * streaming turn does.
 */
function createContainer(scrollHeight: number, clientHeight: number) {
  const element = document.createElement('div');
  const writes: number[] = [];
  let scrollTop = scrollHeight - clientHeight;
  let currentScrollHeight = scrollHeight;

  Object.defineProperty(element, 'scrollHeight', { get: () => currentScrollHeight });
  Object.defineProperty(element, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes.push(next);
    },
  });

  return {
    element: element as HTMLDivElement,
    writes,
    get scrollHeight() {
      return currentScrollHeight;
    },
    setScrollTop: (next: number) => {
      scrollTop = next;
    },
    /** Content arrives; the viewport stays where it is, as the browser leaves it. */
    setScrollHeight: (next: number) => {
      currentScrollHeight = next;
    },
  };
}

function createStore(messagesBySession: Map<string, NormalizedMessage[]>) {
  // A hydrated slot, so the session-loading effect takes its early return
  // instead of re-fetching on every render.
  const slotFor = (sessionId: string) => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: messagesBySession.get(sessionId)?.length ?? 0,
    hasMore: false,
    offset: messagesBySession.get(sessionId)?.length ?? 0,
  });

  return {
    fetchFromServer: vi.fn(async (sessionId: string) => slotFor(sessionId)),
    fetchMore: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), prependedCount: 0 })),
    appendRealtime: vi.fn(),
    refreshLatestFromServer: vi.fn(async (sessionId: string) => ({
      slot: slotFor(sessionId),
      applied: true,
      changed: false,
      deferred: false,
    })),
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn((sessionId: string) => messagesBySession.get(sessionId) ?? []),
    getSessionSlot: vi.fn((sessionId: string) => slotFor(sessionId)),
  };
}

async function renderChatSessionState(options: {
  session: ProjectSession;
  store: ReturnType<typeof createStore>;
}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  return renderHook(
    ({ session }: { session: ProjectSession }) =>
      useChatSessionState({
        isActive: true,
        selectedProject: project,
        selectedSession: session,
        ws: null,
        sendMessage: vi.fn(() => true),
        resetStreamingState: vi.fn(),
        statusCheckSentAtRef: { current: new Map() },
        lastSeqRef: { current: new Map() },
        sessionStore: options.store as never,
      }),
    { initialProps: { session: options.session } },
  );
}

beforeEach(() => {
  // `Date` is faked alongside the timers because the follow gate measures the
  // grace window with `Date.now()`. Leaving the real clock in place would make
  // that window look permanently open, so every "does it still follow?" case
  // would pass without ever exercising the re-engagement it is meant to test.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  // The initial-scroll effect is a separate writer that re-scrolls to the
  // bottom every animation frame until the height settles. It would satisfy an
  // assertion meant for the deferred timer, so it is silenced here — these
  // tests are about which writer wins, and it is not one of the two.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('deferred scroll-to-bottom', () => {
  it('does not yank the view back down when the user scrolls up inside the delay', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    await mountContainer(result, rerender, container, SESSION_A);

    // A new row lands while the user is at the bottom: a scroll is armed for +50ms.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });

    // ...and the user drags upward before it fires. Top of the transcript, so
    // the viewport is nowhere near the bottom band.
    act(() => {
      simulateUserScroll(container, 0);
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    assert.deepEqual(
      container.writes,
      [],
      `a scroll armed before the user scrolled up must not fire afterwards; got ${JSON.stringify(container.writes)}`,
    );
  });

  it('still sticks to the bottom when the user has not scrolled away', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    await mountContainer(result, rerender, container, SESSION_A);

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.writes).toContain(container.scrollHeight);
  });

  it('keeps following while output streams into a viewport the user has not touched', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    await mountContainer(result, rerender, container, SESSION_A);

    // Streaming: the transcript grows, and the browser's default scroll
    // anchoring leaves the viewport exactly where it was — still at the bottom
    // of the content that existed a moment ago, which is now 4500px from the end.
    container.setScrollHeight(9000);
    act(() => {
      simulateUserScroll(container, 4500);
    });

    // The viewport has not left the end: it is pinned to the bottom edge, which
    // is still on screen because the growth happened below it.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    assert.deepEqual(
      container.writes,
      [9000],
      `content arriving below must still pull the viewport to the new bottom; got ${JSON.stringify(container.writes)}`,
    );
  });

  it('does not drag a reader back down as a long message streams in', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(9000, 500);
    await mountContainer(result, rerender, container, SESSION_A);

    // The reader scrolls up into the middle of a long message.
    act(() => {
      simulateUserScroll(container, 3000);
    });

    // The turn keeps streaming, so the transcript grows well past the point the
    // reader stopped at. Every one of these frames used to be a chance to
    // re-pin the viewport.
    container.writes.length = 0;
    for (const height of [9500, 10000, 10600, 11200]) {
      container.setScrollHeight(height);
      act(() => {
        simulateUserScroll(container, 3000);
      });
      messages.set(SESSION_A, [
        ...messages.get(SESSION_A)!,
        buildMessage(messages.get(SESSION_A)!.length, '2026-01-01T00:00:02.000Z'),
      ]);
      act(() => {
        rerender({ session: { id: SESSION_A } as ProjectSession });
      });
      act(() => {
        vi.advanceTimersByTime(80);
      });
    }

    assert.deepEqual(
      container.writes,
      [],
      `a streaming turn must leave a reader who scrolled away alone; got ${JSON.stringify(container.writes)}`,
    );
  });

  it('resumes following once the reader returns to the bottom', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    await mountContainer(result, rerender, container, SESSION_A);

    act(() => {
      simulateUserScroll(container, 1000);
    });

    // The reader scrolls back to the end of the transcript. Land inside the
    // re-engage band rather than exactly on the bottom: a viewport that stops a
    // few pixels short is still "at the end" as far as the reader is concerned.
    act(() => {
      simulateUserScroll(container, 4450);
    });

    // Let the gesture settle before anything arrives.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Now a message lands. This is the render that re-arms follow, and the
    // reason the order matters: a follow is only ever armed by the arrival of
    // new content, so a reader who is already back at the bottom picks the
    // stream up on the next message rather than retroactively.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.writes).toContain(container.scrollHeight);
  });

  it('does not re-pin the viewport while the reader is scrolling near the bottom', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    await mountContainer(result, rerender, container, SESSION_A);

    // A drag that only travels a little, so every intermediate position is still
    // inside the band that used to count as "following". Without the grace
    // window the follow fires between two events of the same gesture, which is
    // what the reader perceives as the log being yanked out from under them.
    const drag = [4490, 4480, 4470, 4460];
    for (const position of drag) {
      act(() => {
        simulateUserScroll(container, position);
      });
    }
    container.writes.length = 0;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });

    // The drag is still in progress, so only the grace window has to elapse —
    // well short of the point where the reader is considered to have stopped.
    act(() => {
      vi.advanceTimersByTime(100);
    });

    assert.deepEqual(
      container.writes,
      [],
      `an in-progress drag must not be overridden mid-gesture; got ${JSON.stringify(container.writes)}`,
    );
  });
});

describe('search jump ownership', () => {
  it('does not follow the user into the next session', { timeout: 20_000 }, async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
      [SESSION_B, [buildMessage(1, '2026-01-01T00:00:05.000Z')]],
    ]);
    const store = createStore(messages);
    const searchSession = {
      id: SESSION_A,
      __searchTargetSnippet: 'message 0',
      __searchTargetTimestamp: '2026-01-01T00:00:00.000Z',
    } as unknown as ProjectSession;

    const { result, rerender } = await renderChatSessionState({ session: searchSession, store });

    const container = createContainer(5000, 500);
    // The row session B renders. The jump requested against session A resolves
    // by timestamp, and on its last retry it accepts the nearest row it can
    // find — which, after the switch, is this one.
    const sessionBRow = document.createElement('div');
    sessionBRow.setAttribute('data-message-timestamp', '2026-01-01T00:00:05.000Z');
    container.element.appendChild(sessionBRow);

    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    // Let the jump arm and start retrying.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The user gives up waiting and opens a different session.
    await act(async () => {
      rerender({ session: { id: SESSION_B } as ProjectSession });
    });

    // Let the whole retry budget elapse (20 retries, 150ms apart).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3400);
    });

    assert.equal(
      scrollIntoView.mock.calls.length,
      0,
      'a jump requested in the previous session must not scroll the new one',
    );
    assert.equal(
      container.element.querySelectorAll('.search-highlight-flash').length,
      0,
      'and must not flash the search highlight on one of its rows',
    );
  });
});
