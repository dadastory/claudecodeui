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
  expect(progress.agents[0].tools[0]).toEqual({ name: 'Read', done: false, failed: false });
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
