import assert from 'node:assert/strict';
import test from 'node:test';

import { isEmbeddedHttpPathAllowed } from '@/shared/embeddedRuntime.js';

test('embedded runtime exposes only research conversation surfaces', () => {
  assert.equal(isEmbeddedHttpPathAllowed('/health'), true);
  assert.equal(isEmbeddedHttpPathAllowed('/api/auth/user'), true);
  assert.equal(isEmbeddedHttpPathAllowed('/api/projects'), true);
  assert.equal(isEmbeddedHttpPathAllowed('/api/file-tree/projects/research/files'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/sessions'), true);
  assert.equal(isEmbeddedHttpPathAllowed('/api/assets/files'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/assets/files', 'POST'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/commands'), false);

  assert.equal(isEmbeddedHttpPathAllowed('/api/git/status'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/worktrees'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/plugins'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/browser-use/status'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/settings/credentials'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/system/update'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/voice/health'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/shell'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/projects', 'POST'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/claude/models', 'POST'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/sessions', 'POST'), true);
});

test('embedded runtime permits session reads but denies provider mutation', () => {
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/sessions/session-1', 'GET'), true);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/sessions/session-1/messages', 'GET'), true);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/claude/models/model-1', 'PATCH'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/claude/mcp/servers', 'POST'), false);
  assert.equal(isEmbeddedHttpPathAllowed('/api/providers/sessions/session-1', 'DELETE'), false);
});
