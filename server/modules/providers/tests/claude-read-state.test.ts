import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { HookInput, HookEvent } from '@anthropic-ai/claude-agent-sdk';

import { createClaudeReadStateRecovery } from '@/modules/providers/services/claude-read-state.service.js';

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-read-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'source');
  await mkdir(cwd);
  const file = path.join(cwd, 'proposal.md');
  await writeFile(file, '# Original\n');
  const seeded: Array<{ file: string; mtime: number }> = [];
  const makeRecovery = (overrides = {}) => createClaudeReadStateRecovery({
    cwd,
    configDir: path.join(root, 'config'),
    seedReadState: async (file: string, mtime: number) => { seeded.push({ file, mtime }); },
    ...overrides,
  });
  const recovery = makeRecovery();
  t.after(() => recovery.close());
  const base = { session_id: 'native-session-a', transcript_path: '', cwd };
  const hook = async (
    event: HookEvent,
    fields: Record<string, unknown> = {},
    instance = recovery,
  ) => {
    const input = { ...base, hook_event_name: event, ...fields } as HookInput;
    const outputs = [];
    for (const matcher of instance.hooks[event] ?? []) {
      for (const callback of matcher.hooks) {
        outputs.push(await callback(input, 'tool-1', { signal: new AbortController().signal }));
      }
    }
    return outputs;
  };
  const read = async (fields: Record<string, unknown> = {}, instance = recovery) => {
    const tool = { tool_name: 'Read', tool_input: { file_path: file }, tool_use_id: 'read-1', ...fields };
    await hook('PreToolUse', tool, instance);
    await hook('PostToolUse', {
      ...tool,
      tool_response: { type: 'text', file: { filePath: file, content: '# Original\n', numLines: 1, totalLines: 1 } },
    }, instance);
  };
  await recovery.start(base.session_id);
  const resume = async () => {
    const next = makeRecovery();
    t.after(() => next.close());
    await next.start(base.session_id);
    return next;
  };
  return { root, cwd, file, seeded, recovery, makeRecovery, hook, read, resume };
}

test('a normal resumed query restores a real successful Read without another file read', async (t) => {
  const f = await fixture(t);
  const originalMtime = Math.floor((await stat(f.file)).mtimeMs);
  await f.read();
  await f.resume();
  assert.deepEqual(f.seeded, [{ file: f.file, mtime: originalMtime }]);
});

test('active-turn compaction proactively reminds the main agent of the native Read prerequisite', async (t) => {
  const f = await fixture(t);
  const [result] = await f.hook('SessionStart', { source: 'compact' });
  assert.ok('hookSpecificOutput' in result);
  assert.equal(result.hookSpecificOutput?.hookEventName, 'SessionStart');
  assert.match(JSON.stringify(result), /each existing file/);
  assert.match(JSON.stringify(result), /new paths may be created directly/);
  assert.deepEqual(await f.hook('SessionStart', { source: 'compact', agent_id: 'worker' }), [{}]);
});

test('new files and existing files that were never read are never seeded', async (t) => {
  const f = await fixture(t);
  for (const file of [f.file, path.join(f.cwd, 'new.md')]) {
    await f.hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: file, content: 'new' }, tool_use_id: 'write' });
  }
  await f.resume();
  assert.deepEqual(f.seeded, []);
});

test('changed author files stay protected even if their old mtime is restored', async (t) => {
  const f = await fixture(t);
  await f.read();
  const before = await stat(f.file);
  await writeFile(f.file, '# Modified\n');
  await utimes(f.file, before.atime, before.mtime);
  await f.resume();
  assert.deepEqual(f.seeded, []);
});

test('an edit during Read does not register the newer bytes as observed', async (t) => {
  const f = await fixture(t);
  const tool = { tool_name: 'Read', tool_input: { file_path: f.file }, tool_use_id: 'racing-read' };
  await f.hook('PreToolUse', tool);
  await writeFile(f.file, '# Changed during Read\n');
  await f.hook('PostToolUse', {
    ...tool,
    tool_response: { type: 'text', file: { filePath: f.file, content: '# Original\n' } },
  });
  await f.resume();
  assert.deepEqual(f.seeded, []);
});

test('failed reads and another agent never grant the main agent read state', async (t) => {
  const f = await fixture(t);
  await f.hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: f.file }, tool_use_id: 'failed-read' });
  await f.hook('PostToolUseFailure', { tool_name: 'Read', tool_input: { file_path: f.file }, tool_use_id: 'failed-read', error: 'Permission denied' });
  await f.read({ agent_id: 'worker-a' });
  await f.read({ session_id: 'another-session' });
  await f.resume();
  assert.deepEqual(f.seeded, []);
});

test('normal resume persists only the matching native session and workspace', async (t) => {
  const f = await fixture(t);
  await f.read();
  await f.recovery.close();
  const resumed = f.makeRecovery();
  t.after(() => resumed.close());
  await resumed.start('native-session-a');
  assert.equal(f.seeded.length, 1);
  f.seeded.length = 0;
  const other = f.makeRecovery();
  t.after(() => other.close());
  await other.start('native-session-b');
  assert.deepEqual(f.seeded, []);
});

test('editing history discards future reads instead of restoring them', async (t) => {
  const f = await fixture(t);
  await f.read();
  const rewound = f.makeRecovery({ reset: true });
  t.after(() => rewound.close());
  await rewound.start('native-session-a');
  assert.deepEqual(f.seeded, []);
  // A late callback from the replaced run cannot republish the discarded state.
  await f.read();
  const resumed = f.makeRecovery();
  t.after(() => resumed.close());
  await resumed.start('native-session-a');
  assert.deepEqual(f.seeded, []);
});

test('clearing a live conversation discards its earlier observations', async (t) => {
  const f = await fixture(t);
  await f.read();
  await f.hook('SessionStart', { source: 'clear' });
  await f.resume();
  assert.deepEqual(f.seeded, []);
});

test('a narrowed file boundary does not regain earlier writable access', async (t) => {
  const f = await fixture(t);
  await f.read();
  const restricted = f.makeRecovery({ canAccess: async () => false });
  t.after(() => restricted.close());
  await restricted.start('native-session-a');
  assert.deepEqual(f.seeded, []);
});

test('a different workspace cannot reuse the native session observations', async (t) => {
  const f = await fixture(t);
  await f.read();
  const otherCwd = path.join(f.root, 'another-source');
  await mkdir(otherCwd);
  const other = f.makeRecovery({ cwd: otherCwd });
  t.after(() => other.close());
  await other.start('native-session-a');
  assert.deepEqual(f.seeded, []);
});

test('a removed observed file is not recreated or seeded during resume', async (t) => {
  const f = await fixture(t);
  await f.read();
  await rm(f.file);
  await f.resume();
  assert.deepEqual(f.seeded, []);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('an unavailable SDK seed API leaves the agent free to perform a real Read', async (t) => {
  const f = await fixture(t);
  await f.read();
  const unavailable = f.makeRecovery({ seedReadState: async () => { throw new Error('Unsupported control request'); } });
  t.after(() => unavailable.close());
  await unavailable.start('native-session-a');
  assert.deepEqual(f.seeded, []);
});

test('a retargeted symlink does not restore the prior target read', async (t) => {
  if (process.platform === 'win32') return t.skip('Symlink privileges vary on Windows.');
  const f = await fixture(t);
  const link = path.join(f.cwd, 'linked.md');
  await symlink(f.file, link);
  await f.read({ tool_input: { file_path: link } });
  await rm(link);
  const other = path.join(f.cwd, 'other.md');
  await writeFile(other, '# Another file\n');
  await symlink(other, link);
  await f.resume();
  assert.deepEqual(f.seeded, []);
});

test('a successful Write also preserves the file version the model just authored', async (t) => {
  const f = await fixture(t);
  const content = '# New chapter\n';
  const file = path.join(f.cwd, 'new.md');
  const tool = { tool_name: 'Write', tool_input: { file_path: file, content }, tool_use_id: 'new-write' };
  await f.hook('PreToolUse', tool);
  await writeFile(file, content);
  await f.hook('PostToolUse', { ...tool, tool_response: { type: 'create', filePath: file, content, originalFile: null } });
  await f.resume();
  assert.equal(f.seeded[0]?.file, file);
});

test('recovery metadata does not retain file content', async (t) => {
  const f = await fixture(t);
  await f.read();
  const { readdir } = await import('node:fs/promises');
  const directory = path.join(f.root, 'config', 'cloudcli-read-state');
  const names = await readdir(directory);
  assert.equal(names.length, 1);
  const stored = await readFile(path.join(directory, names[0]), 'utf8');
  assert.ok(!stored.includes('# Original'));
  assert.ok(stored.includes(f.file));
});
