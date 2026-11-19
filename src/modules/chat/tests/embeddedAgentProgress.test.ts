import { expect, test } from 'vitest';

import { buildEmbeddedAgentProgress } from '@/modules/chat/hooks/useEmbeddedAgentProgress';
import type { ChatMessage } from '@/shared/types';

const worker: ChatMessage = {
  type: 'assistant', timestamp: 1, isSubagentContainer: true, toolId: 'worker-1',
  toolInput: { subagent_type: 'literature', description: 'Find relevant sources' },
  subagentActivity: [{ kind: 'tool', toolName: 'Read', toolId: 'read-1' }],
};
test('live workers expose their stage and actual tool completion', () => {
  const progress = buildEmbeddedAgentProgress('session-a', [worker], true);
  expect(progress.status).toBe('running');
  expect(progress.agents[0]).toMatchObject({ id: 'worker-1', stage: 'literature', status: 'running', toolCount: 1 });
  expect(progress.agents[0].tools[0]).toEqual({ id: 'read-1', name: 'Read', done: false, failed: false });
});
test('history metadata keeps a background worker live after the parent turn', () => {
  const background = { ...worker, subagent: { id: 'a', status: 'running' as const } };
  expect(buildEmbeddedAgentProgress('session-a', [background], false).status).toBe('waiting');
});
test('a stopped uncompleted invocation is not labelled complete', () => {
  expect(buildEmbeddedAgentProgress('session-a', [worker], false).agents[0].status).toBe('interrupted');
  expect(buildEmbeddedAgentProgress('session-b', [], false).agents).toEqual([]);
});
test('a failed child remains failed after a history reload', () => {
  const failed = { ...worker, subagent: { id: 'a', status: 'failed' as const } };
  expect(buildEmbeddedAgentProgress('session-a', [failed], false).agents[0].status).toBe('failed');
});

test('an async launch acknowledgement is not a completed child report', () => {
  const background = { ...worker, toolResult: { content: 'Launched', toolUseResult: { status: 'async_launched' } } };
  expect(buildEmbeddedAgentProgress('session-a', [background], false).status).toBe('waiting');
  expect(buildEmbeddedAgentProgress('session-a', [background], false).agents[0].status).toBe('running');
});

test('callable worker names map back to the existing stage identifiers', () => {
  const baseline = { ...worker, toolInput: { subagent_type: 'rebuttal-baseline' } };
  expect(buildEmbeddedAgentProgress('session-a', [baseline], true).agents[0].stage).toBe('rebuttal_baseline');
});

test('explicit cancellation overrides stale running metadata', () => {
  const background = { ...worker, subagent: { id: 'a', status: 'running' as const } };
  const stopped = buildEmbeddedAgentProgress('session-a', [background], false, true);
  expect(stopped.status).toBe('interrupted');
  expect(stopped.agents[0].status).toBe('interrupted');
});


test('direct coordinator tools are visible without any child agent', () => {
  const edit: ChatMessage = { type: 'assistant', timestamp: 2, isToolUse: true, toolId: 'edit-1', toolName: 'Edit' };
  const progress = buildEmbeddedAgentProgress('session-a', [edit], true);
  expect(progress.agents).toHaveLength(1);
  expect(progress.agents[0]).toMatchObject({ id: 'edit-1', stage: 'coordinator', status: 'running', currentTool: 'Edit' });
});

test('Task tool-call IDs distinguish repeated executions of the same named worker', () => {
  const repeated = { ...worker, toolId: 'worker-2', timestamp: 2 };
  const progress = buildEmbeddedAgentProgress('session-a', [worker, repeated], true);
  expect(progress.agents.map((agent) => agent.id)).toEqual(['worker-1', 'worker-2']);
});

test('reloaded transcript tools keep their actual completed and failed outcomes', () => {
  const read: ChatMessage = { type: 'assistant', timestamp: 1, isToolUse: true, toolId: 'read', toolName: 'Read', toolResult: { content: 'Source' } };
  const failed = { ...read, toolId: 'edit', toolName: 'Edit', toolResult: { content: 'Conflict', isError: true } };
  const progress = buildEmbeddedAgentProgress('session-a', [read, failed], false);
  expect(progress.agents.map((step) => step.status)).toEqual(['completed', 'failed']);
  expect(progress.agents.every((step) => step.currentTool === null)).toBe(true);
});

test('explicit waiting is retained and future plan text adds no steps', () => {
  const waiting: ChatMessage = { type: 'assistant', timestamp: 1, isToolUse: true, toolId: 'question', toolName: 'AskUserQuestion', toolStatus: 'waiting' };
  const plan: ChatMessage = { type: 'assistant', timestamp: 2, content: 'Next: literature, rationale, methods' };
  const progress = buildEmbeddedAgentProgress('session-a', [waiting, plan], false);
  expect(progress.status).toBe('waiting');
  expect(progress.agents).toHaveLength(1);
  expect(progress.agents[0].status).toBe('waiting');
});

test('duplicate transcript rows deduplicate by actual call ID, never timestamp', () => {
  const completed = { ...worker, toolResult: { content: 'Done' } };
  expect(buildEmbeddedAgentProgress('session-a', [worker, completed], false).agents).toHaveLength(1);
  const missingIdentity = { ...worker, toolId: undefined };
  expect(buildEmbeddedAgentProgress('session-a', [missingIdentity], true).agents).toEqual([]);
});


test('an actual unanswered author question waits without needing a future-stage placeholder', () => {
  const question: ChatMessage = { type: 'assistant', timestamp: 1, isToolUse: true, toolId: 'ask-1', toolName: 'AskUserQuestion' };
  expect(buildEmbeddedAgentProgress('session-a', [question], true).agents[0].status).toBe('waiting');
});
