import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { createHeldPromptStream } from '@/modules/providers/services/claude-prompt-stream.service.js';

const message: SDKUserMessage = {
  type: 'user', message: { role: 'user', content: 'Input stays local' }, parent_tool_use_id: null,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('actual SDK can pull input during construction before the caller assigns the query', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-prompt-startup-'));
  const abortController = new AbortController();
  const stoppedBeforeModel = new Error('Stop before sending any model request');
  let instance: ReturnType<typeof query> | null = null;
  let child: ChildProcessWithoutNullStreams | undefined;
  let childClosed: Promise<unknown> = Promise.resolve();
  const held = createHeldPromptStream([message], async () => {
    assert.ok(instance, 'query() has not returned yet');
    assert.equal(typeof instance.initializationResult, 'function');
    abortController.abort(stoppedBeforeModel);
  });
  try {
    instance = query({ prompt: held.stream, options: {
      cwd, abortController, tools: [], settingSources: [],
      env: { HOME: cwd, CLAUDE_CONFIG_DIR: cwd, ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'local-test-only' },
      // Exercise installed SDK ordering without invoking a real CLI or model.
      spawnClaudeCodeProcess: () => {
        child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { cwd, stdio: 'pipe' });
        childClosed = once(child, 'close');
        return child;
      },
    } });
    await assert.rejects(async () => { for await (const _event of instance!) { /* No prompt is sent. */ } }, /Operation aborted/);
    assert.equal(abortController.signal.reason, stoppedBeforeModel);
  } finally {
    held.release();
    instance?.close();
    child?.kill();
    await childClosed;
    await rm(cwd, { recursive: true, force: true });
  }
});

test('startup and read restoration finish before input; background work holds stdin open', async () => {
  const initialized = deferred(), restored = deferred(), preparing = deferred();
  const held = createHeldPromptStream([message], async () => {
    preparing.resolve(); await initialized.promise; await restored.promise;
  });
  let delivered = false;
  const first = held.stream.next().then((result) => { delivered = true; return result; });
  await preparing.promise; initialized.resolve(); await Promise.resolve();
  assert.equal(delivered, false);
  restored.resolve();
  assert.deepEqual(await first, { value: message, done: false });
  let closed = false;
  const end = held.stream.next().then((result) => { closed = true; return result; });
  await Promise.resolve(); assert.equal(closed, false);
  held.release(); assert.equal((await end).done, true);
});

test('preparation failure preserves its cause and cannot deliver a prompt', async () => {
  const failure = new Error('Initialization failed');
  const held = createHeldPromptStream([message], async () => { throw failure; });
  try { await assert.rejects(held.stream.next(), (error) => error === failure); }
  finally { held.release(); }
});
