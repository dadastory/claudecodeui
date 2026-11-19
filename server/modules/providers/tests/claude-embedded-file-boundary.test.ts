import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createEmbeddedFileBoundaryHook } from '@/modules/providers/list/claude/claude-runtime.provider.js';

const profile = {
  workspaceRoot: '/workspace/source',
  readableRoots: ['/workspace/.cloudcli', '/workspace/.research', '/app/skills'],
  writablePaths: ['sections/'],
};

const denied = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'Tool path is outside the active research stage boundary',
  },
};

test('embedded file boundary hook permits reads outside the source root that a stage needs', async () => {
  const hook = createEmbeddedFileBoundaryHook(profile);

  // Every one of these is required for a stage to do its work, and every one of
  // them lives outside the source tree the stage owns: its skill files, the
  // persisted session, the research tool's storage, and the MCP bridge config.
  for (const filePath of [
    '/app/skills/proposal-literature-evidence/SKILL.md',
    '/workspace/.cloudcli/.claude/settings.json',
    '/workspace/.research/arxiv/paper.json',
    '/workspace/source/sections/02-literature.typ',
    'sections/02-literature.typ',
  ]) {
    assert.deepEqual(
      await hook({ tool_name: 'Read', tool_input: { file_path: filePath } }),
      {},
      `Read should be allowed for ${filePath}`,
    );
  }
});

test('embedded file boundary hook still blocks reads outside every readable root', async () => {
  const hook = createEmbeddedFileBoundaryHook(profile);

  assert.deepEqual(
    await hook({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }),
    denied,
  );
  // A path that escapes the source tree by traversal is not inside it.
  assert.deepEqual(
    await hook({ tool_name: 'Read', tool_input: { file_path: '/workspace/source/../../etc/passwd' } }),
    denied,
  );
});

test('embedded file boundary hook still gates writes on the stage writable paths', async () => {
  const hook = createEmbeddedFileBoundaryHook(profile);

  assert.deepEqual(
    await hook({ tool_name: 'Write', tool_input: { file_path: '/workspace/source/sections/02.typ' } }),
    {},
  );
  assert.deepEqual(
    await hook({ tool_name: 'Edit', tool_input: { file_path: 'sections/03.typ' } }),
    {},
  );
  // In the source tree but not a path this stage owns.
  assert.deepEqual(
    await hook({ tool_name: 'Write', tool_input: { file_path: '/workspace/source/main.typ' } }),
    denied,
  );
  // Readable, but never writable.
  assert.deepEqual(
    await hook({ tool_name: 'Write', tool_input: { file_path: '/app/skills/proposal-rationale/SKILL.md' } }),
    denied,
  );
  assert.deepEqual(
    await hook({ tool_name: 'Write', tool_input: { file_path: '/workspace/source/sections/../../outside.typ' } }),
    denied,
  );
});

test('embedded file boundary hook allows a pathless search and bounds a scoped one', async () => {
  const hook = createEmbeddedFileBoundaryHook(profile);

  // No `path` means the workspace, which is readable by construction.
  assert.deepEqual(await hook({ tool_name: 'Glob', tool_input: { pattern: '**/*.typ' } }), {});
  assert.deepEqual(await hook({ tool_name: 'Grep', tool_input: { pattern: 'typst' } }), {});
  assert.deepEqual(
    await hook({ tool_name: 'Glob', tool_input: { pattern: '*', path: '/workspace/.research' } }),
    {},
  );
  assert.deepEqual(
    await hook({ tool_name: 'Grep', tool_input: { pattern: '*', path: '/etc' } }),
    denied,
  );
});

test('embedded file boundary hook does not govern tools outside the file set', async () => {
  const hook = createEmbeddedFileBoundaryHook(profile);

  // A tool this boundary does not model must not be silently blocked by it.
  assert.deepEqual(
    await hook({ tool_name: 'mcp__llm4ad_stage__publish_stage_result', tool_input: { artifact: {} } }),
    {},
  );
});


test('trusted scratch permits draft writes without widening shared source ownership', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'embedded-scratch-'));
  const root = await realpath(temporary);
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const scratch = path.join(root, '.research', 'drafts');
  await mkdir(source, { recursive: true });
  await mkdir(scratch, { recursive: true });
  const restricted = { workspaceRoot: source, readableRoots: [path.join(root, '.research')], writablePaths: ['sections/'] };
  const hook = createEmbeddedFileBoundaryHook({ ...restricted, scratchRoot: scratch });
  for (const tool of ['Write', 'Edit']) {
    assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: path.join(scratch, 'methods', 'task-1', 'draft.typ') } }), {});
    assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: '../.research/drafts/methods/task-2/draft.typ' } }), {});
    assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: path.join(source, 'main.typ') } }), denied);
    assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: path.join(scratch, '..', 'context.json') } }), denied);
    assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: `${scratch}-other/draft.typ` } }), denied);
  }
  assert.deepEqual(await createEmbeddedFileBoundaryHook(restricted)({ tool_name: 'Write', tool_input: { file_path: path.join(scratch, 'draft.typ') } }), denied);
});

test('scratch and source symlinks cannot escape into secrets, even for a new file', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'embedded-scratch-links-'));
  const root = await realpath(temporary);
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const scratch = path.join(root, '.research', 'drafts');
  const secrets = path.join(root, 'private');
  await Promise.all([mkdir(path.join(source, 'sections'), { recursive: true }), mkdir(scratch, { recursive: true }), mkdir(secrets)]);
  await writeFile(path.join(secrets, 'secret.txt'), 'private');
  await writeFile(path.join(root, 'outside.txt'), 'private');
  await symlink(secrets, path.join(scratch, 'escape'), 'dir');
  await symlink(secrets, path.join(source, 'sections', 'escape'), 'dir');
  await symlink(path.join(secrets, 'not-created'), path.join(scratch, 'dangling'), 'dir');
  const hook = createEmbeddedFileBoundaryHook({ workspaceRoot: source, readableRoots: [path.join(root, '.research')], writablePaths: ['sections/'], scratchRoot: scratch });
  for (const link of [path.join(scratch, 'escape'), path.join(source, 'sections', 'escape')]) {
    for (const tool of ['Read', 'Write', 'Edit']) {
      assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: path.join(link, 'secret.txt') } }), denied);
    }
    assert.deepEqual(await hook({ tool_name: 'Write', tool_input: { file_path: path.join(link, 'new-file.typ') } }), denied);
    for (const tool of ['Read', 'Write', 'Edit']) {
      assert.deepEqual(await hook({ tool_name: tool, tool_input: { file_path: `${link}/../outside.txt` } }), denied);
    }
    assert.deepEqual(await hook({ tool_name: 'Write', tool_input: { file_path: `${link}/../new-outside.typ` } }), denied);
    assert.deepEqual(await hook({ tool_name: 'Glob', tool_input: { path: link, pattern: '*' } }), denied);
  }
  assert.deepEqual(await hook({ tool_name: 'Write', tool_input: { file_path: path.join(scratch, 'dangling', 'new.typ') } }), denied);
  const redirected = path.join(root, 'redirected');
  await symlink(secrets, redirected, 'dir');
  const redirectedHook = createEmbeddedFileBoundaryHook({ workspaceRoot: source, writablePaths: [], scratchRoot: redirected });
  assert.deepEqual(await redirectedHook({ tool_name: 'Write', tool_input: { file_path: path.join(redirected, 'new.typ') } }), denied);
});
