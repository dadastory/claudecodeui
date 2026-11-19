import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { HookInput, HookJSONOutput, Options } from '@anthropic-ai/claude-agent-sdk';

type FileVersion = {
  file: string;
  target: string;
  mtime: number;
  modified: string;
  changed: string;
  size: string;
  device: string;
  inode: string;
};

const MAX_TRACKED_FILES = 512;
// A replaced query must not save observations from the abandoned history branch.
const activeRecoveries = new Map<string, { owner: symbol; saves: () => Promise<void> }>();

function sameVersion(left: FileVersion, right: FileVersion): boolean {
  return Object.keys(left).every((key) => left[key as keyof FileVersion] === right[key as keyof FileVersion]);
}

async function versionOf(file: string): Promise<FileVersion | null> {
  try {
    const target = await fs.realpath(file);
    const stats = await fs.stat(target, { bigint: true });
    if (!stats.isFile()) return null;
    return {
      file, target, mtime: Number(stats.mtimeNs / 1_000_000n),
      modified: String(stats.mtimeNs), changed: String(stats.ctimeNs),
      size: String(stats.size), device: String(stats.dev), inode: String(stats.ino),
    };
  } catch {
    return null;
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

/**
 * Used by the Claude provider to retain verified main-agent observations across
 * normal resume. SDK seeding restores bookkeeping, not permission:
 * unread, changed, deleted, retargeted and out-of-boundary files remain protected.
 * Subagent observations cannot seed the main CLI because the SDK has no agent
 * target for seedReadState. Historical rewinds start with an empty observation set.
 */
export function createClaudeReadStateRecovery(options: {
  cwd?: string;
  configDir?: string;
  reset?: boolean;
  seedReadState: (file: string, mtime: number) => Promise<void>;
  canAccess?: (file: string) => Promise<boolean>;
}): { hooks: NonNullable<Options['hooks']>; start: (nativeSessionId: string) => Promise<void>; close: () => Promise<void> } {
  const cwd = path.resolve(options.cwd || process.cwd());
  const storageRoot = path.join(options.configDir || path.join(os.homedir(), '.claude'), 'cloudcli-read-state');
  const owner = Symbol('claude-read-observations');
  const records = new Map<string, FileVersion>();
  const pendingReads = new Map<string, FileVersion>();
  let sessionId = '';
  let storePath = '';
  let closed = false;
  let saveQueue = Promise.resolve();

  const owns = (input?: HookInput) => !closed && Boolean(storePath)
    && activeRecoveries.get(storePath)?.owner === owner
    && (!input || (input.session_id === sessionId && !input.agent_id));

  const permitted = async (file: string) => !options.canAccess || options.canAccess(file);

  const save = async () => {
    saveQueue = saveQueue.then(async () => {
      if (!owns()) return;
      await fs.mkdir(storageRoot, { recursive: true, mode: 0o700 });
      const temporary = `${storePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ sessionId, cwd, records: [...records.values()] }), { mode: 0o600 });
        if (owns()) await fs.rename(temporary, storePath);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }).catch(() => {
      // Cache persistence is optional; native Read/Edit validation stays active.
    });
    await saveQueue;
  };

  const remember = (version: FileVersion) => {
    records.delete(version.file);
    records.set(version.file, version);
    while (records.size > MAX_TRACKED_FILES) records.delete(records.keys().next().value!);
  };

  const restore = async () => {
    if (!owns()) return;
    for (const [file, observed] of records) {
      if (!owns()) return;
      const current = await versionOf(file);
      if (!current || !sameVersion(observed, current) || !await permitted(file)) {
        records.delete(file);
        continue;
      }
      // Pass the observed mtime, never a fresh timestamp masquerading as a Read.
      try {
        await options.seedReadState(file, observed.mtime);
      } catch {
        // An unavailable control API must fall back to a genuine agent Read.
        return;
      }
    }
    await save();
  };

  const start = async (nativeSessionId: string): Promise<void> => {
    if (closed || sessionId || !nativeSessionId) return;
    sessionId = nativeSessionId;
    const key = createHash('sha256').update(JSON.stringify([sessionId, cwd])).digest('hex');
    storePath = path.join(storageRoot, `${key}.json`);
    const previous = activeRecoveries.get(storePath);
    activeRecoveries.set(storePath, { owner, saves: () => saveQueue });
    // Finish an already dispatched rename before a replacement/rewind loads or
    // clears the cache; late callbacks from the older owner cannot write again.
    await previous?.saves();
    if (!options.reset) {
      try {
        const saved = recordOf(JSON.parse(await fs.readFile(storePath, 'utf8')));
        if (saved.sessionId === sessionId && saved.cwd === cwd && Array.isArray(saved.records)) {
          for (const value of saved.records.slice(-MAX_TRACKED_FILES)) {
            const item = recordOf(value);
            if (typeof item.file === 'string' && path.isAbsolute(item.file)
              && typeof item.target === 'string' && Number.isSafeInteger(item.mtime)
              && ['modified', 'changed', 'size', 'device', 'inode'].every((field) => typeof item[field] === 'string')) {
              remember(item as FileVersion);
            }
          }
        }
      } catch {
        // Missing or damaged cache metadata cannot grant a file observation.
      }
    }
    await restore();
  };

  const beforeTool = async (input: HookInput): Promise<HookJSONOutput> => {
    if (!owns(input) || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Read') return {};
    const args = recordOf(input.tool_input);
    if (typeof args.file_path !== 'string') return {};
    const file = path.resolve(input.cwd || cwd, args.file_path);
    if (!await permitted(file)) return {};
    const version = await versionOf(file);
    if (version) pendingReads.set(input.tool_use_id, version);
    return {};
  };

  const afterTool = async (input: HookInput): Promise<HookJSONOutput> => {
    if (!owns(input) || input.hook_event_name !== 'PostToolUse') return {};
    const args = recordOf(input.tool_input);
    const response = recordOf(input.tool_response);
    const previous = pendingReads.get(input.tool_use_id);
    pendingReads.delete(input.tool_use_id);
    if (typeof args.file_path !== 'string') return {};
    const file = path.resolve(input.cwd || cwd, args.file_path);
    if (!await permitted(file)) return {};
    const current = await versionOf(file);
    if (!current) return {};
    if (input.tool_name === 'Read') {
      if (!previous || !sameVersion(previous, current)
        || response.type !== 'text' || typeof recordOf(response.file).content !== 'string') return {};
    } else if (input.tool_name === 'Write' || input.tool_name === 'Edit') {
      let authored: unknown = response.content;
      if (input.tool_name === 'Edit' && typeof response.originalFile === 'string'
        && typeof args.old_string === 'string' && args.old_string && typeof args.new_string === 'string') {
        authored = args.replace_all
          ? response.originalFile.split(args.old_string).join(args.new_string)
          : response.originalFile.replace(args.old_string, () => args.new_string as string);
      }
      if (typeof authored !== 'string') return {};
      try {
        const text = await fs.readFile(file, 'utf8');
        const afterRead = await versionOf(file);
        if (!afterRead || !sameVersion(current, afterRead) || normalizeText(text) !== normalizeText(authored)) return {};
      } catch {
        return {};
      }
    } else {
      return {};
    }
    remember(current);
    await save();
    return {};
  };

  return {
    // The SDK does not emit startup/resume SessionStart callbacks. The provider
    // calls start after initialization and before releasing the first prompt.
    start,
    hooks: {
      SessionStart: [{ hooks: [async (input) => {
        if (owns(input) && input.hook_event_name === 'SessionStart' && input.source === 'clear') {
          records.clear();
          pendingReads.clear();
          await save();
        }
        if (owns(input) && input.hook_event_name === 'SessionStart' && input.source === 'compact') {
          // The native active turn replaces its read map after compact hooks;
          // seedReadState cannot update that map, even when it acknowledges.
          // Give the model the native prerequisite before it attempts a write.
          return {
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: 'File-tool state was reset by context compaction. Before the first Edit or Write to each existing file after this compaction, use the native Read tool on that file again. Earlier summaries, MCP content and another agent\'s reads do not register a native Read. Genuinely new paths may be created directly with Write without a failed Read. Continue the author\'s request without narrating this internal housekeeping.',
            },
          };
        }
        return {};
      }] }],
      PreToolUse: [{ matcher: 'Read', hooks: [beforeTool] }],
      PostToolUse: [{ matcher: 'Read|Write|Edit', hooks: [afterTool] }],
      PostToolUseFailure: [{ matcher: 'Read', hooks: [async (input) => {
        if (owns(input) && input.hook_event_name === 'PostToolUseFailure') pendingReads.delete(input.tool_use_id);
        return {};
      }] }],
    },
    close: async () => {
      closed = true;
      await saveQueue;
      if (activeRecoveries.get(storePath)?.owner === owner) activeRecoveries.delete(storePath);
      pendingReads.clear();
    },
  };
}
