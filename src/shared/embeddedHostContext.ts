import { useSyncExternalStore } from 'react';

type EmbeddedHostContext = {
  stageTitle: string;
  stageDescription: string;
  stageExamples: string[];
};

const EMPTY_CONTEXT: EmbeddedHostContext = {
  stageTitle: '',
  stageDescription: '',
  stageExamples: [],
};

let currentContext = EMPTY_CONTEXT;
const listeners = new Set<() => void>();

function normalizedText(value: unknown, maximumLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function normalizedTextList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizedText(item, maximumLength))
    .filter(Boolean)
    .slice(0, maximumItems);
}

/** Update the trusted host-owned context displayed by the embedded conversation. */
export function updateEmbeddedHostContext(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const nextContext = {
    stageTitle: normalizedText(record.stageTitle, 160),
    stageDescription: normalizedText(record.stageDescription, 1000),
    stageExamples: normalizedTextList(record.stageExamples, 3, 600),
  };
  if (
    nextContext.stageTitle === currentContext.stageTitle &&
    nextContext.stageDescription === currentContext.stageDescription &&
    nextContext.stageExamples.length === currentContext.stageExamples.length &&
    nextContext.stageExamples.every(
      (example, index) => example === currentContext.stageExamples[index],
    )
  ) {
    return;
  }
  currentContext = nextContext;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): EmbeddedHostContext {
  return currentContext;
}

/** Return live stage guidance supplied by the authenticated LLM4AD host page. */
export function useEmbeddedHostContext(): EmbeddedHostContext {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CONTEXT);
}
