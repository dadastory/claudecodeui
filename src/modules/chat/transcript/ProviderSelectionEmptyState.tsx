import React, { useCallback, useMemo, useState } from "react";
import { ArrowUpRight, BookOpenText, ChevronDown, Plus } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import type {
  ProjectSession,
  LLMProvider,
  ProviderModelActions,
  ProviderModelsDefinition,
} from "@/shared/types";
import { NextTaskBanner } from "@/modules/task-master";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  Card,
  Button,
  LLMProviderLogo,
} from "@/shared/ui";
import ModelGroupList, { type ModelGroup } from "@/modules/chat/composer/ModelGroupList";
import ModelLibraryPanel from "@/modules/chat/modals/ModelLibraryPanel";
import { writeSelectedProvider } from '@/shared/selectedProvider';
import { useEmbeddedHostContext } from '@/shared/embeddedHostContext';
import { IS_LLM4AD_EMBEDDED } from '@/shared/utils';

const PROVIDER_META: { id: LLMProvider; name: string }[] = [
  { id: "claude", name: "Anthropic" },
  { id: "codex", name: "OpenAI" },
  { id: "cursor", name: "Cursor" },
  { id: "opencode", name: "OpenCode" },
];

const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// cmdk's default filter is fuzzy (loose character-subsequence scoring), which
// surfaces unrelated models — e.g. searching "chatgpt" also matched "Fable".
// Require every whitespace-separated search token to appear as a literal
// substring instead, so "claude 4.5" still matches "Anthropic Claude Haiku 4.5"
// but "chatgpt" only matches models that actually contain it.
function modelSearchFilter(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (next: LLMProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  providerModels: Record<LLMProvider, string>;
  /** Records the pick as this provider's default and persists it. */
  setProviderModel: (provider: LLMProvider, model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  onSubmitSuggestedPrompt: (prompt: string) => Promise<void>;
};

function ReviewPasteStarter({
  onSubmitSuggestedPrompt,
}: {
  onSubmitSuggestedPrompt: (prompt: string) => Promise<void>;
}) {
  const { t } = useTranslation('chat');
  const [reviewText, setReviewText] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reports = reviewText.trim();
    if (!reports) return;
    void onSubmitSuggestedPrompt(`${t('session.continue.reviewPastePrompt')}\n\n${reports}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-7 border border-primary/25 bg-primary/[0.025] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-1 block h-7 w-1 shrink-0 bg-primary/70" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-semibold text-foreground">
            {t('session.continue.reviewPasteTitle')}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t('session.continue.reviewPasteDescription')}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <textarea
          required
          value={reviewText}
          onChange={(event) => setReviewText(event.target.value)}
          aria-label={t('session.continue.reviewPasteLabel')}
          placeholder={t('session.continue.reviewPastePlaceholder')}
          rows={7}
          className="max-h-72 min-h-40 w-full resize-y overflow-y-auto rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
        />
        <Button type="submit" disabled={!reviewText.trim()} className="min-h-10 self-end gap-2">
          {t('session.continue.reviewPasteStart')}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </form>
  );
}

function getModelConfig(
  p: LLMProvider,
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): ProviderModelsDefinition {
  const entry = catalog[p];
  return entry ?? { OPTIONS: [], DEFAULT: "" };
}

function getProviderDisplayName(p: LLMProvider) {
  if (p === "claude") return "Claude";
  if (p === "cursor") return "Cursor";
  if (p === "codex") return "Codex";
  if (p === "opencode") return "OpenCode";
  return "Claude";
}

/**
 * Rendered by chat's ChatMessagesPane when a session has no messages yet, so
 * the user can pick a provider, model and permission mode before their first turn.
 */
export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  providerModels,
  setProviderModel,
  providerModelCatalog,
  providerModelActions,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  onSubmitSuggestedPrompt,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const embeddedHost = useEmbeddedHostContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);

  const [modelSearch, setModelSearch] = useState("");

  /**
   * Opens and closes the picker, clearing the search on the way out.
   *
   * The search box is controlled, so a query left behind comes back with the
   * dialog - and brings every branch open with it, since searching expands
   * them. Reopening would undo the collapsing this picker is built around.
   */
  const setPickerOpen = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setModelSearch("");
    }
  }, []);

  /** One collapsible branch per provider, in the order the picker lists them. */
  const visibleProviderGroups = useMemo<ModelGroup[]>(
    () => PROVIDER_META.map((meta) => ({
      key: meta.id,
      provider: meta.id,
      name: meta.name,
      models: providerModelCatalog[meta.id]?.OPTIONS ?? [],
    })),
    [providerModelCatalog],
  );

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  const currentModel = providerModels[provider];
  const stageExamples = IS_LLM4AD_EMBEDDED ? embeddedHost.stageExamples : [];

  const applyStageExample = useCallback(
    (example: string) => {
      setInput(example);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setInput, textareaRef],
  );

  const currentModelLabel = useMemo(() => {
    const config = getModelConfig(provider, providerModelCatalog);
    const found = config.OPTIONS.find(
      (o: { value: string; label: string }) => o.value === currentModel,
    );
    return found?.label || currentModel;
  }, [provider, currentModel, providerModelCatalog]);

  const handleModelSelect = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      setProvider(providerId);
      writeSelectedProvider(providerId);
      setProviderModel(providerId, modelValue);
      setPickerOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    [setProvider, setProviderModel, setPickerOpen, textareaRef],
  );

  const openModelLibrary = () => {
    setPickerOpen(false);
    setModelLibraryOpen(true);
  };

  const closeModelLibrary = () => {
    setModelLibraryOpen(false);
    setPickerOpen(true);
  };

  if (IS_LLM4AD_EMBEDDED && !selectedSession && !currentSessionId) {
    return null;
  }

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-[34.25rem]">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("providerSelection.title")}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("providerSelection.description")}
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger asChild>
              <Card
                className="group mx-auto max-w-xs cursor-pointer border-border/60 transition-all duration-150 hover:border-border hover:shadow-md active:scale-[0.99]"
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-2 p-3">
                  <LLMProviderLogo
                    provider={provider}
                    className="h-5 w-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-foreground">
                        {getProviderDisplayName(provider)}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="truncate text-xs text-foreground">
                        {currentModelLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("providerSelection.clickToChange", {
                        defaultValue: "Click to change model",
                      })}
                    </p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
                </div>
              </Card>
            </DialogTrigger>

            <DialogContent className="max-w-md overflow-hidden p-0">
              <DialogTitle>Model Selector</DialogTitle>
              <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("providerSelection.chooseModel", {
                      defaultValue: "Choose a model",
                    })}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("providerSelection.chooseModelDescription", {
                      defaultValue: "Built-in and custom models in one list",
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={openModelLibrary}
                  className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("providerSelection.addModel", { defaultValue: "Add model" })}
                </Button>
              </div>
              <Command filter={modelSearchFilter}>
                <CommandInput
                  value={modelSearch}
                  onValueChange={setModelSearch}
                  placeholder={t("providerSelection.searchModels", {
                    defaultValue: "Search models...",
                  })}
                />
                <CommandList className="max-h-[350px]">
                  <CommandEmpty>
                    {t("providerSelection.noModelsFound", {
                      defaultValue: "No models found.",
                    })}
                  </CommandEmpty>
                  <ModelGroupList
                    groups={visibleProviderGroups}
                    provider={provider}
                    currentModel={currentModel}
                    loading={providerModelsLoading}
                    searching={modelSearch.trim().length > 0}
                    onSelect={handleModelSelect}
                    loadingLabel={t("providerSelection.loadingModels", {
                      defaultValue: "Loading models…",
                    })}
                  />
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>

          <Dialog
            open={modelLibraryOpen}
            onOpenChange={(open) => {
              if (open) {
                setModelLibraryOpen(true);
              } else {
                closeModelLibrary();
              }
            }}
          >
            <DialogContent className="flex h-[min(90dvh,46rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden rounded-3xl p-4 sm:p-5">
              <DialogTitle>
                {t("providerSelection.manageModels", {
                  defaultValue: "Manage models",
                })}
              </DialogTitle>
              <ModelLibraryPanel
                initialProvider={provider}
                providerModelCatalog={providerModelCatalog}
                actions={providerModelActions}
                onDone={closeModelLibrary}
              />
            </DialogContent>
          </Dialog>

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {
              {
                claude: t("providerSelection.readyPrompt.claude", {
                  model: providerModels.claude,
                }),
                cursor: t("providerSelection.readyPrompt.cursor", {
                  model: providerModels.cursor,
                }),
                codex: t("providerSelection.readyPrompt.codex", {
                  model: providerModels.codex,
                }),
                opencode: t("providerSelection.readyPrompt.opencode", {
                  model: providerModels.opencode,
                  defaultValue: "Ready with OpenCode {{model}}",
                }),
              }[provider]
            }
          </p>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground/60">
            <Trans
              ns="chat"
              i18nKey="providerSelection.pressToSearch"
              values={{ shortcut: MOD_KEY === "⌘" ? "⌘K" : "Ctrl+K" }}
              components={{
                kbd: (
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]" />
                ),
              }}
            />
          </p>

          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession && IS_LLM4AD_EMBEDDED) {
    return (
      <div className="flex h-full overflow-y-auto px-4 py-6">
        <div className="my-auto w-full max-w-none">
          <div className="border-l-2 border-primary/60 pl-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
              <BookOpenText aria-hidden="true" className="h-4 w-4" />
              <span>{embeddedHost.stageTitle || t("input.embeddedStageFallback")}</span>
            </div>
            <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              {t("session.continue.embeddedTitle", {
                stage:
                  embeddedHost.stageTitle ||
                  t("input.embeddedStageFallback"),
              })}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
              {embeddedHost.stageDescription ||
                t("session.continue.embeddedDescription")}
            </p>
          </div>

          {embeddedHost.stage === 'rebuttal_baseline' && (
            <ReviewPasteStarter onSubmitSuggestedPrompt={onSubmitSuggestedPrompt} />
          )}

          {stageExamples.length > 0 && (
            <section className="mt-8 border-y border-border/80 text-left">
              <div className="py-4">
                <h3 className="font-serif text-lg font-semibold text-foreground">
                  {t("session.continue.guideTitle")}
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("session.continue.guideDescription")}
                </p>
              </div>
              <div className="divide-y divide-border/70 border-t border-border/70">
                {stageExamples.map((example, index) => (
                  <button
                    key={example}
                    type="button"
                    className="group flex w-full items-start gap-4 px-1 py-4 text-left transition-colors hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3"
                    onClick={() => applyStageExample(example)}
                  >
                    <span className="w-8 shrink-0 font-serif text-xl tabular-nums leading-6 text-muted-foreground/65">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 text-sm leading-6 text-foreground/90">
                      {example}
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 text-center">
        <div className="w-full max-w-[38rem]">
          <p className="text-lg font-semibold text-foreground">
            {t("session.continue.title")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("session.continue.description")}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
