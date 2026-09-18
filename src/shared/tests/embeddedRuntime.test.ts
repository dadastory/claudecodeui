import { afterEach, describe, expect, it } from 'vitest';

import {
  detectEmbeddedBasePath,
  resolveEmbeddedHttpUrl,
  resolveEmbeddedWebSocketPath,
} from '@/shared/embeddedRuntime';

describe('embedded runtime URL resolution', () => {
  const originalPathname = window.location.pathname;

  afterEach(() => {
    window.history.replaceState({}, '', originalPathname || '/');
  });

  it('keeps root deployments unchanged', () => {
    window.history.replaceState({}, '', '/session/example');

    expect(detectEmbeddedBasePath()).toBe('');
    expect(resolveEmbeddedHttpUrl('/api/projects')).toBe('/api/projects');
    expect(resolveEmbeddedWebSocketPath('/ws')).toBe('/ws');
  });

  it('prefixes runtime requests beneath the LLM4AD workspace route', () => {
    window.history.replaceState(
      {},
      '',
      '/api/v1/llm4ad/papers/workspaces/workspace-id/cloudcli/session/example',
    );

    const basePath = '/api/v1/llm4ad/papers/workspaces/workspace-id/cloudcli';
    expect(detectEmbeddedBasePath()).toBe(basePath);
    expect(resolveEmbeddedHttpUrl('/api/projects')).toBe(`${basePath}/api/projects`);
    expect(resolveEmbeddedWebSocketPath('/ws')).toBe(`${basePath}/ws`);
    expect(resolveEmbeddedHttpUrl(`${basePath}/api/projects`)).toBe(`${basePath}/api/projects`);
  });
});
