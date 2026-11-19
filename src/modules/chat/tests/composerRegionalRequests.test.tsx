import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';
import type * as SharedUtils from '@/shared/utils';

/** Exercise durable regional requests through the real composer send path. */
vi.mock('@/shared/utils', async (original) => ({
  ...await original<typeof SharedUtils>(), IS_LLM4AD_EMBEDDED: true,
}));

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

// The composer only ever reaches the network through these; stubbing them keeps
// the test about draft scoping rather than about fetch behaviour in jsdom.
vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      getFiles: () => okJson([]),
      commands: { list: () => okJson({ success: true, commands: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
      providers: {
        skills: () => okJson({ success: true, data: { skills: [] } }),
      },
    },
  };
});

const renderComposer = (
  selectedSession: ProjectSession | null,
  sendMessage: (message: unknown) => boolean = () => true,
  isLoading = false,
) => renderHook(
  ({ session }: { session: ProjectSession | null }) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: session,
    currentSessionId: session?.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage,
    followLatestMessage: () => undefined,
    addMessage: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }),
  { initialProps: { session: selectedSession } },
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetChatDrafts();
});
afterEach(() => vi.restoreAllMocks());

const request = () => {
  window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin,
    source: window.parent,
    data: { type: 'llm4ad:submit-prompt', requestId: 'request-1', prompt: 'Read request-1 and revise its selected region' },
  }));
};

test('acknowledges a successful regional send once and deduplicates replay', async () => {
  const send = vi.fn(() => true);
  const ack = vi.spyOn(window.parent, 'postMessage');
  const view = renderComposer({ id: 'session-a' }, send);
  await act(async () => request());
  await waitFor(() => assert.equal(send.mock.calls.length, 1));
  assert.equal(view.result.current.input, '');
  assert.ok(ack.mock.calls.some(([data]) => data.type === 'llm4ad:prompt-accepted' && data.requestId === 'request-1'));
  await act(async () => request());
  assert.equal(send.mock.calls.length, 1);
  view.unmount();
});

test('keeps author drafts intact and waits until they are cleared', async () => {
  const send = vi.fn(() => true);
  const view = renderComposer({ id: 'session-a' }, send);
  await act(async () => view.result.current.setInput('Author draft'));
  await act(async () => request());
  assert.equal(send.mock.calls.length, 0);
  assert.equal(view.result.current.input, 'Author draft');
  await act(async () => view.result.current.setInput(''));
  await act(async () => request());
  await waitFor(() => assert.equal(send.mock.calls.length, 1));
  view.unmount();
});

test('failed websocket sends stay retryable and are never acknowledged', async () => {
  const send = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const ack = vi.spyOn(window.parent, 'postMessage');
  const view = renderComposer({ id: 'session-a' }, send);
  await act(async () => request());
  assert.equal(view.result.current.input, '');
  assert.ok(!ack.mock.calls.some(([data]) => data.type === 'llm4ad:prompt-accepted'));
  await act(async () => request());
  await waitFor(() => assert.equal(send.mock.calls.length, 2));
  assert.ok(ack.mock.calls.some(([data]) => data.type === 'llm4ad:prompt-accepted'));
  view.unmount();
});

test('busy assistants defer regional requests without creating another queued draft', async () => {
  const send = vi.fn(() => true);
  const view = renderComposer({ id: 'session-a' }, send, true);
  await act(async () => request());
  assert.equal(send.mock.calls.length, 0);
  assert.equal(view.result.current.queuedDraft, null);
  assert.equal(view.result.current.input, '');
  view.unmount();
});
