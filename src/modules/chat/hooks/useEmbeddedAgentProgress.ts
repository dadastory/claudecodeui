import { useEffect, useRef } from 'react';

import type { ChatMessage, EmbeddedAgentProgress, ServerEvent } from '@/shared/types';
import { IS_LLM4AD_EMBEDDED } from '@/shared/utils';

/** Used by the embedded chat and its tests to project actual child-agent records. */
export function buildEmbeddedAgentProgress(sessionId: string, messages: ChatMessage[], processing: boolean, interrupted = false): EmbeddedAgentProgress {
  const children: EmbeddedAgentProgress["agents"] = messages.filter((message) => message.isSubagentContainer).map((message) => {
    const input = message.toolInput && typeof message.toolInput === 'object' ? message.toolInput as Record<string, unknown> : {};
    const activity = message.subagentActivity ?? [];
    const tools = activity.filter((entry) => entry.kind === 'tool');
    const acknowledgement = message.toolResult?.toolUseResult as { status?: string } | undefined;
    const asynchronous = acknowledgement?.status === 'async_launched';
    const status = message.subagent?.status
      ?? (message.toolResult?.isError ? 'failed' : asynchronous ? 'running' : message.toolResult ? 'completed' : processing ? 'running' : 'interrupted');
    return {
      id: message.toolId ?? message.subagent?.id ?? String(message.timestamp), parentId: 'main',
      stage: (message.subagent?.type ?? String(input.subagent_type ?? '')).replace(/-/g, '_'),
      description: message.subagent?.description ?? String(input.description ?? ''), status: interrupted && status === 'running' ? 'interrupted' : status,
      toolCount: tools.length, currentTool: tools.at(-1)?.toolName ?? null,
      tools: tools.map((tool) => ({ name: tool.toolName ?? '', done: Boolean(tool.toolResult), failed: Boolean(tool.toolResult?.isError) })),
    };
  });
  const hasBackground = children.some((child) => child.status === 'running');
  const latestTool = [...messages].reverse().find((message) => message.isToolUse && !message.isSubagentContainer);
  return {
    sessionId, status: interrupted ? 'interrupted' : processing ? 'running' : hasBackground ? 'waiting' : messages.length ? 'idle' : 'ready',
    currentTool: processing ? latestTool?.toolName ?? null : null, agents: children,
  };
}

/** Used by ChatInterface to report progress to its authenticated, same-origin host. */
export function useEmbeddedAgentProgress(sessionId: string | null, messages: ChatMessage[], processing: boolean, subscribe?: (listener: (event: ServerEvent) => void) => () => void): void {
  // Keep only the latest snapshot while one scheduled host update is pending.
  const latest = useRef({ sessionId, messages, processing });
  useEffect(() => { latest.current = { sessionId, messages, processing }; }, [sessionId, messages, processing]);
  const pending = useRef<number | null>(null);
  // An explicit abort supersedes running metadata still present in the transcript.
  const interrupted = useRef(new Set<string>());
  useEffect(() => {
    if (sessionId && processing) interrupted.current.delete(sessionId);
  }, [sessionId, processing]);
  useEffect(() => {
    if (!IS_LLM4AD_EMBEDDED || !sessionId || !subscribe) return;
    return subscribe((event) => {
      if (event.kind !== 'complete' || !event.aborted || event.sessionId !== sessionId) return;
      interrupted.current.add(sessionId);
      window.parent.postMessage({ type: 'llm4ad:agent-progress', progress: buildEmbeddedAgentProgress(sessionId, latest.current.messages, false, true) }, window.location.origin);
    });
  }, [sessionId, subscribe]);
  useEffect(() => () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
  }, [sessionId]);
  useEffect(() => {
    if (!IS_LLM4AD_EMBEDDED || !sessionId || window.parent === window || pending.current !== null) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      const snapshot = latest.current;
      if (snapshot.sessionId !== sessionId) return;
      window.parent.postMessage({ type: 'llm4ad:agent-progress', progress: buildEmbeddedAgentProgress(sessionId, snapshot.messages, snapshot.processing, interrupted.current.has(sessionId)) }, window.location.origin);
    }, 80);
  }, [sessionId, messages, processing]);
}
