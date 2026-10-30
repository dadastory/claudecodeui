import { useSyncExternalStore } from 'react';

import type { EmbeddedModelBinding, EmbeddedModelOption } from '@/shared/types';

type EmbeddedHostContext = {
  stage: string;
  stageTitle: string;
  stageDescription: string;
  stageExamples: string[];
  modelBinding: EmbeddedModelBinding | null;
  modelOptions: EmbeddedModelOption[];
  modelsLoading: boolean;
  modelUpdating: boolean;
  modelError: string;
  conversationPreferences: {
    reply_language: 'auto' | 'zh' | 'en';
    additional_guidance: string;
  };
  preferencesUpdating: boolean;
  preferencesError: string;
};

const EMPTY_CONTEXT: EmbeddedHostContext = {
  stage: '',
  stageTitle: '',
  stageDescription: '',
  stageExamples: [],
  modelBinding: null,
  modelOptions: [],
  modelsLoading: false,
  modelUpdating: false,
  modelError: '',
  conversationPreferences: { reply_language: 'auto', additional_guidance: '' },
  preferencesUpdating: false,
  preferencesError: '',
};

let currentContext = EMPTY_CONTEXT;
const listeners = new Set<() => void>();

function normalizedText(value: unknown, maximumLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function normalizedTextList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] {
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
  const binding = record.modelBinding as Partial<EmbeddedModelBinding> | null;
  const preferences = record.conversationPreferences as Record<
    string,
    unknown
  > | null;
  const nextContext: EmbeddedHostContext = {
    stage: normalizedText(record.stage, 64),
    stageTitle: normalizedText(record.stageTitle, 160),
    stageDescription: normalizedText(record.stageDescription, 1000),
    stageExamples: normalizedTextList(record.stageExamples, 3, 600),
    modelBinding:
      binding &&
      typeof binding.provider_id === 'string' &&
      typeof binding.model_name === 'string' &&
      typeof binding.context_window_tokens === 'number' &&
      typeof binding.max_output_tokens === 'number'
        ? {
            provider_id: binding.provider_id,
            model_name: binding.model_name,
            context_window_tokens: binding.context_window_tokens,
            max_output_tokens: binding.max_output_tokens,
          }
        : null,
    modelOptions: Array.isArray(record.modelOptions)
      ? record.modelOptions.flatMap((option: unknown) => {
          if (!option || typeof option !== 'object') return [];
          const item = option as Record<string, unknown>;
          return typeof item.provider_id === 'string' &&
            typeof item.provider_name === 'string' &&
            typeof item.model_name === 'string'
            ? [
                {
                  provider_id: item.provider_id,
                  provider_name: item.provider_name,
                  model_name: item.model_name,
                },
              ]
            : [];
        })
      : [],
    modelsLoading: record.modelsLoading === true,
    modelUpdating: record.modelUpdating === true,
    modelError: normalizedText(record.modelError, 1000),
    conversationPreferences: {
      reply_language:
        preferences?.reply_language === 'zh' ||
        preferences?.reply_language === 'en'
          ? preferences.reply_language
          : ('auto' as const),
      additional_guidance: normalizedText(
        preferences?.additional_guidance,
        4000,
      ),
    },
    preferencesUpdating: record.preferencesUpdating === true,
    preferencesError: normalizedText(record.preferencesError, 1000),
  };
  if (JSON.stringify(nextContext) === JSON.stringify(currentContext)) {
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
