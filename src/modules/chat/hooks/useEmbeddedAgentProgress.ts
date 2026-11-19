import { useEffect, useRef } from 'react';

import type { ChatMessage, EmbeddedAgentProgress, ServerEvent } from '@/shared/types';
import { IS_LLM4AD_EMBEDDED } from '@/shared/utils';

type ProgressStep = Omit<EmbeddedAgentProgress['agents'][number], 'status' | 'tools'> & {
  status: EmbeddedAgentProgress['agents'][number]['status'] | 'waiting';
  startedAt?: string;
  tools: { id?: string; name: string; done: boolean; failed: boolean }[];
};
type ActualProgress = Omit<EmbeddedAgentProgress, 'agents'> & { agents: ProgressStep[] };

/** Used by embedded chat and its tests to project live and rehydrated tool calls. */
export function buildEmbeddedAgentProgress(
  sessionId: string,
  messages: ChatMessage[],
  processing: boolean,
  interrupted = false,
): ActualProgress {
  const steps = new Map<string, ProgressStep>();
  for (const message of messages) {
    if (!message.isSubagentContainer && !message.isToolUse) continue;
    // A timestamp or worker name cannot distinguish repeated executions reliably.
    const id = message.toolId ?? message.toolCallId ?? message.subagent?.id;
    if (!id) continue;
    const input = message.toolInput && typeof message.toolInput === 'object'
      ? message.toolInput as Record<string, unknown> : {};
    const tools = message.isSubagentContainer
      ? (message.subagentActivity ?? []).filter((entry) => entry.kind === 'tool')
      : [{ toolId: id, toolName: message.toolName, toolResult: message.toolResult }];
    const acknowledgement = message.toolResult?.toolUseResult as { status?: string } | undefined;
    const asynchronous = acknowledgement?.status === 'async_launched';
    const lifecycle = message.toolStatus?.toLowerCase();
    const reported = message.subagent?.status;
    let status: ProgressStep['status'] = message.toolResult?.isError || lifecycle === 'failed' || reported === 'failed'
      ? 'failed'
      : reported ?? (lifecycle === 'waiting' || lifecycle === 'pending_permission'
        || (message.toolName === 'AskUserQuestion' && !message.toolResult) ? 'waiting'
        : lifecycle === 'interrupted' || lifecycle === 'cancelled' ? 'interrupted'
          : asynchronous ? 'running' : message.toolResult || lifecycle === 'completed' ? 'completed'
            : processing ? 'running' : 'interrupted');
    if (interrupted && (status === 'running' || status === 'waiting')) status = 'interrupted';
    const active = status === 'running' || status === 'waiting';
    const step: ProgressStep = {
      id,
      parentId: 'main',
      stage: message.isSubagentContainer
        ? (message.subagent?.type ?? String(input.subagent_type ?? '')).replace(/-/g, '_')
        : 'coordinator',
      description: message.isSubagentContainer
        ? message.subagent?.description ?? String(input.description ?? '')
        : String(message.toolName ?? 'Tool'),
      status,
      toolCount: tools.length,
      currentTool: active ? tools.at(-1)?.toolName ?? null : null,
      tools: tools.map((tool) => ({
        ...(tool.toolId ? { id: tool.toolId } : {}),
        name: tool.toolName ?? '',
        done: Boolean(tool.toolResult),
        failed: Boolean(tool.toolResult?.isError),
      })),
    };
    steps.set(id, step);
  }
  const agents = [...steps.values()];
  const hasBackground = agents.some((child) => child.status === 'running' || child.status === 'waiting');
  const latestTool = [...agents].reverse().find((step) => step.stage === 'coordinator'
    && (step.status === 'running' || step.status === 'waiting'));
  return {
    sessionId,
    status: interrupted ? 'interrupted' : processing ? 'running' : hasBackground ? 'waiting' : messages.length ? 'idle' : 'ready',
    currentTool: processing ? latestTool?.currentTool ?? null : null,
    agents,
  };
}

/** Used by ChatInterface to report transcript-backed progress to its same-origin host. */
export function useEmbeddedAgentProgress(
  sessionId: string | null,
  messages: ChatMessage[],
  processing: boolean,
  subscribe?: (listener: (event: ServerEvent) => void) => () => void,
): void {
  // Abort events need the latest transcript without resubscribing on every row.
  const latest = useRef({ sessionId, messages, processing });
  useEffect(() => { latest.current = { sessionId, messages, processing }; }, [sessionId, messages, processing]);
  // Retain explicit cancellation until a real new processing turn resumes.
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
  useEffect(() => {
    if (!IS_LLM4AD_EMBEDDED || !sessionId || window.parent === window) return;
    window.parent.postMessage({
      type: 'llm4ad:agent-progress',
      progress: buildEmbeddedAgentProgress(sessionId, messages, processing, interrupted.current.has(sessionId)),
    }, window.location.origin);
  }, [sessionId, messages, processing]);
}
