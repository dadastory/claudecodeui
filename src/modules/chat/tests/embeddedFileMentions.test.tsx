import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

const getFiles = vi.hoisted(() => vi.fn());

vi.mock('@/shared/api', () => ({
  api: { getFiles },
}));

beforeEach(() => {
  getFiles.mockReset();
  vi.stubEnv('VITE_LLM4AD_EMBEDDED', 'true');
  vi.resetModules();
});

test('embedded chat does not load the hidden native file mention index', async () => {
  const { useFileMentions } = await import('@/modules/chat/hooks/useFileMentions');
  const selectedProject = {
    projectId: 'embedded-project',
    path: '/workspace/source',
    fullPath: '/workspace/source',
    displayName: 'Embedded project',
    sessions: [],
  };

  renderHook(() => useFileMentions({
    selectedProject,
    input: '',
    setInput: vi.fn(),
    textareaRef: React.createRef<HTMLTextAreaElement>(),
  }));

  await Promise.resolve();
  assert.equal(getFiles.mock.calls.length, 0);
});
