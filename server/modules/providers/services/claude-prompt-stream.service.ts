import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Keep provider input open after startup and read-state restoration.
 *
 * The Claude runtime releases this stream when its turn has no remaining
 * background work or when it is stopped.
 */
export function createHeldPromptStream(
  messages: readonly SDKUserMessage[],
  beforePrompt: () => Promise<void> = async () => {},
): { stream: AsyncGenerator<SDKUserMessage>; release: () => void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const stream = (async function* () {
    // query() pulls input before returning its instance to the caller.
    // Restore state only after that synchronous construction has completed.
    await Promise.resolve();
    await beforePrompt();
    for (const message of messages) yield message;
    await held;
  })();
  return { stream, release };
}
