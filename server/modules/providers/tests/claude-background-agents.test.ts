import assert from 'node:assert/strict';
import test from 'node:test';

import { startsBackgroundWork } from '@/modules/providers/list/claude/claude-runtime.provider.js';

for (const name of ['Agent', 'Task', 'Bash']) {
  test(`${name} background work keeps the input stream alive`, () => {
    const message = { message: { content: [{ type: 'tool_use', name, input: { run_in_background: true } }] } };
    assert.equal(startsBackgroundWork(message), true);
    message.message.content[0].input.run_in_background = false;
    assert.equal(startsBackgroundWork(message), false);
  });
}

test('an asynchronous launch acknowledgement keeps default-background agents alive', () => {
  assert.equal(startsBackgroundWork({ tool_use_result: { status: 'async_launched' } }), true);
  assert.equal(startsBackgroundWork({ type: 'system', subtype: 'task_started' }), true);
  assert.equal(startsBackgroundWork({ type: 'system', subtype: 'task_progress' }), true);
  assert.equal(startsBackgroundWork({ type: 'system', subtype: 'task_notification' }), false);
});

test('embedded profiles keep coordinator and worker skills separate', async () => {
  const { setEmbeddedRuntimeProfile } = await import('@/shared/embeddedProfile.js');
  const { mapCliOptionsToSDK } = await import('@/modules/providers/list/claude/claude-runtime.provider.js');
  setEmbeddedRuntimeProfile({
    sessionId: 'coordinator-profile-test', model: 'bound-model',
    skills: ['research-workflow-coordinator', 'proposal-methods'], mainSkills: ['research-workflow-coordinator'],
    agents: { methods: { description: 'Write methods', prompt: 'Read the current workflow.', model: 'inherit', skills: ['proposal-methods'] } },
  });
  const options = mapCliOptionsToSDK({ sessionId: 'coordinator-profile-test' });
  assert.deepEqual(options.skills, ['research-workflow-coordinator']);
  assert.deepEqual(options.agents.methods.skills, ['proposal-methods']);
  assert.equal(options.agents.methods.model, 'inherit');
  assert.equal(options.model, 'bound-model');
});
