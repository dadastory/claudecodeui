import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Cpu,
  Loader2,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

import { useEmbeddedHostContext } from '@/shared/embeddedHostContext';
import { Button, Input } from '@/shared/ui';
import type { EmbeddedModelBinding } from '@/shared/types';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

/** Used by ChatComposer to select platform models and token settings without a dialog. */
export function EmbeddedModelControls({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('chat');
  const host = useEmbeddedHostContext();
  // Only one of the neighboring menus may cover the transcript at a time.
  const [menu, setMenu] = useState<'models' | 'context' | null>(null);
  // Filter the host catalog without changing the workspace's current model.
  const [query, setQuery] = useState('');
  // Keep unsaved context edits local until the user applies them.
  const [limits, setLimits] = useState({ context: 0, output: 0 });
  const close = useCallback(() => setMenu(null), []);
  const {
    triggerRef: modelTriggerRef,
    menuRef: modelMenuRef,
    anchor: modelAnchor,
    updateAnchor: updateModelAnchor,
  } = useComposerMenuAnchor(menu === 'models', close, 360, 'start');
  const {
    triggerRef: contextTriggerRef,
    menuRef: contextMenuRef,
    anchor: contextAnchor,
    updateAnchor: updateContextAnchor,
  } = useComposerMenuAnchor(menu === 'context', close, 320, 'start');
  const binding = host.modelBinding;
  if (!binding) return null;
  const busy = disabled || host.modelUpdating || host.preferencesUpdating;
  const label = t('composer.platformModel');
  const contextLabel = t('composer.contextSettings');
  const filtered = host.modelOptions.filter((option) =>
    `${option.provider_name} ${option.model_name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const groups = [...new Set(filtered.map((option) => option.provider_id))];
  const validLimits =
    Number.isInteger(limits.context) &&
    Number.isInteger(limits.output) &&
    limits.context >= 8192 &&
    limits.output >= 1024 &&
    limits.output <= limits.context;
  const save = (next: EmbeddedModelBinding) => {
    if (busy) return;
    window.parent.postMessage(
      { type: 'llm4ad:update-model-binding', binding: next },
      window.location.origin,
    );
    close();
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        ref={modelTriggerRef}
        type="button"
        disabled={busy}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu === 'models'}
        title={`${label}: ${binding.model_name}`}
        className="flex h-8 min-w-0 max-w-48 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 text-sm text-foreground hover:bg-muted disabled:opacity-50 sm:max-w-72"
        onClick={() => {
          updateModelAnchor();
          setQuery('');
          setMenu((current) => (current === 'models' ? null : 'models'));
        }}
      >
        {host.modelUpdating ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <Cpu className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{binding.model_name}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      <button
        ref={contextTriggerRef}
        type="button"
        disabled={busy}
        aria-label={contextLabel}
        aria-haspopup="dialog"
        aria-expanded={menu === 'context'}
        title={contextLabel}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        onClick={() => {
          updateContextAnchor();
          setLimits({
            context: binding.context_window_tokens,
            output: binding.max_output_tokens,
          });
          setMenu((current) => (current === 'context' ? null : 'context'));
        }}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{contextLabel}</span>
      </button>

      {menu === 'models' &&
        modelAnchor &&
        createPortal(
          <ComposerMenuSurface
            anchor={modelAnchor}
            menuRef={modelMenuRef}
            ariaLabel={label}
          >
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-popover px-2 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                autoFocus
                aria-label={t('composer.searchModels')}
                placeholder={t('composer.searchModels')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 min-w-0 border-0 bg-transparent shadow-none"
              />
            </div>
            {host.modelsLoading && (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                {t('composer.loadingModels')}
              </p>
            )}
            {!host.modelsLoading && !filtered.length && (
              <p className="p-3 text-sm text-muted-foreground">
                {t('composer.noMatchingModels')}
              </p>
            )}
            {groups.map((providerId) => (
              <div key={providerId}>
                <ComposerMenuHeading>
                  {
                    filtered.find((option) => option.provider_id === providerId)
                      ?.provider_name
                  }
                </ComposerMenuHeading>
                {filtered
                  .filter((option) => option.provider_id === providerId)
                  .map((option) => (
                    <ComposerMenuItem
                      key={option.model_name}
                      label={option.model_name}
                      isSelected={
                        binding.provider_id === providerId &&
                        binding.model_name === option.model_name
                      }
                      onSelect={() =>
                        save({
                          ...binding,
                          provider_id: providerId,
                          model_name: option.model_name,
                        })
                      }
                    />
                  ))}
              </div>
            ))}
          </ComposerMenuSurface>,
          document.body,
        )}
      {menu === 'context' &&
        contextAnchor &&
        createPortal(
          <div
            ref={contextMenuRef}
            role="dialog"
            aria-label={contextLabel}
            className="fixed z-[100] w-80 overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
            style={{
              left: contextAnchor.left,
              bottom: contextAnchor.bottom,
              maxHeight: contextAnchor.maxHeight,
              maxWidth: contextAnchor.maxWidth,
            }}
          >
            <h3 className="text-sm font-semibold">{contextLabel}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('composer.contextHint')}
            </p>
            <label className="mt-4 flex flex-col gap-1.5 text-sm">
              {t('composer.contextWindow')}
              <Input
                type="number"
                min={8192}
                step={1}
                value={limits.context}
                onChange={(event) =>
                  setLimits((previous) => ({
                    ...previous,
                    context: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="mt-3 flex flex-col gap-1.5 text-sm">
              {t('composer.outputLimit')}
              <Input
                type="number"
                min={1024}
                max={limits.context}
                step={1}
                value={limits.output}
                onChange={(event) =>
                  setLimits((previous) => ({
                    ...previous,
                    output: Number(event.target.value),
                  }))
                }
              />
            </label>
            {!validLimits && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {t('composer.invalidContext')}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                {t('composer.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={!validLimits || busy}
                onClick={() =>
                  save({
                    ...binding,
                    context_window_tokens: limits.context,
                    max_output_tokens: limits.output,
                  })
                }
              >
                {t('composer.apply')}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
