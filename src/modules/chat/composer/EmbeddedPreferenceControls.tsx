import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Languages, Loader2 } from 'lucide-react';

import { useEmbeddedHostContext } from '@/shared/embeddedHostContext';
import { Button } from '@/shared/ui';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';

/** Used by ChatComposer to adjust workspace conversation preferences beside its model. */
export function EmbeddedPreferenceControls({
  disabled,
}: {
  disabled: boolean;
}) {
  const { t } = useTranslation('chat');
  const host = useEmbeddedHostContext();
  // Preserve unsaved presentation preferences only while the small menu is open.
  const [draft, setDraft] = useState(host.conversationPreferences);
  // The preference menu is independent of the native provider's CLI settings.
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(
    open,
    close,
    360,
    'start',
  );
  if (!host.modelBinding) return null;
  const label = t('composer.preferences');
  const busy = disabled || host.modelUpdating || host.preferencesUpdating;

  return (
    <div className="flex min-w-0 flex-col">
      <button
        ref={triggerRef}
        type="button"
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        onClick={() => {
          updateAnchor();
          setDraft(host.conversationPreferences);
          setOpen((value) => !value);
        }}
      >
        {host.preferencesUpdating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Languages className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={label}
            className="fixed z-[100] w-[360px] overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
            style={{
              left: anchor.left,
              bottom: anchor.bottom,
              maxHeight: anchor.maxHeight,
              maxWidth: anchor.maxWidth,
            }}
          >
            <h3 className="text-sm font-semibold">{label}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t(host.stage === 'autodesign' ? 'composer.preferencesAutoDesignHint' : 'composer.preferencesHint')}
            </p>
            <div
              role="group"
              aria-label={t('composer.replyLanguage')}
              className="mt-4 flex gap-1.5"
            >
              {(['auto', 'zh', 'en'] as const).map((language) => (
                <Button
                  key={language}
                  size="sm"
                  variant={
                    draft.reply_language === language ? 'default' : 'outline'
                  }
                  aria-pressed={draft.reply_language === language}
                  onClick={() =>
                    setDraft((previous) => ({
                      ...previous,
                      reply_language: language,
                    }))
                  }
                >
                  {t(`composer.language.${language}`)}
                </Button>
              ))}
            </div>
            <label className="mt-4 flex flex-col gap-1.5 text-sm">
              {t('composer.extraGuidance')}
              <textarea
                rows={4}
                maxLength={4000}
                value={draft.additional_guidance}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    additional_guidance: event.target.value,
                  }))
                }
                className="w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={close}>
                {t('composer.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  window.parent.postMessage(
                    { type: 'llm4ad:update-preferences', preferences: draft },
                    window.location.origin,
                  );
                  close();
                }}
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
