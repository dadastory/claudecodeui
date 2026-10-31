import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import ChatComposer from '@/modules/chat/composer/ChatComposer';
import type * as SharedUtils from '@/shared/utils';

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...await importOriginal<typeof SharedUtils>(),
  IS_LLM4AD_EMBEDDED: true,
}));
vi.mock('@/modules/chat/hooks/useVoiceAvailable', () => ({ useVoiceAvailable: () => false }));

test('activity and stop controls follow the composer input container', () => {
  const noop = () => undefined;
  const abort = vi.fn();
  const submit = vi.fn();
  const props: React.ComponentProps<typeof ChatComposer> = {
    pendingPermissionRequests: [],
    handlePermissionDecision: noop,
    handleGrantToolPermission: () => ({ success: true }),
    activity: { statusText: 'Working', canInterrupt: true, startedAt: Date.now() },
    isLoading: true,
    onAbortSession: abort,
    permissionMode: 'default',
    availablePermissionModes: [],
    onSelectPermissionMode: noop,
    providerLabel: 'Claude',
    effort: '',
    availableEffortOptions: [],
    onSelectEffort: noop,
    model: '',
    availableModelOptions: [],
    onSelectModel: noop,
    modelsLoading: false,
    settingsError: 'Could not save the selected model',
    tokenBudget: null,
    onShowTokenUsage: noop,
    slashCommandsCount: 0,
    onToggleCommandMenu: noop,
    hasInput: false,
    onClearInput: noop,
    onSubmit: submit,
    isDragActive: false,
    queuedDraft: null,
    isEditingSentMessage: false,
    onCancelEditMessage: noop,
    scheduledMessages: [],
    onScheduleMessage: noop,
    onCancelScheduledMessage: noop,
    onEditQueuedDraft: noop,
    onDeleteQueuedDraft: noop,
    attachedFiles: [],
    onRemoveAttachment: noop,
    fileErrors: new Map(),
    showFileDropdown: false,
    filteredFiles: [],
    selectedFileIndex: 0,
    onSelectFile: noop,
    filteredCommands: [],
    selectedCommandIndex: 0,
    onCommandSelect: noop,
    onCloseCommandMenu: noop,
    isCommandMenuOpen: false,
    frequentCommands: [],
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    openAttachmentPicker: noop,
    inputHighlightRef: React.createRef<HTMLDivElement>(),
    renderInputWithMentions: (text) => text,
    textareaRef: React.createRef<HTMLTextAreaElement>(),
    input: '',
    onInputChange: noop,
    onTextareaClick: noop,
    onTextareaKeyDown: noop,
    onTextareaPaste: noop,
    onTextareaScrollSync: noop,
    onTextareaInput: noop,
    placeholder: 'Message',
    isTextareaExpanded: false,
  };

  const { container } = render(<ChatComposer {...props} />);
  const input = container.querySelector('[data-slot="prompt-input"]');
  const activity = container.querySelector('.llm4ad-composer-activity');
  const stop = activity?.querySelector('button');

  assert.ok(input);
  assert.ok(activity);
  assert.equal(activity.closest('form'), input);
  assert.ok(stop);
  assert.equal(stop.type, 'button');
  fireEvent.click(stop);
  assert.equal(abort.mock.calls.length, 1);
  assert.equal(submit.mock.calls.length, 0);
  const error = container.querySelector('[role="alert"]');
  assert.equal(error?.textContent?.trim(), 'Could not save the selected model');
  assert.equal(error?.closest('[data-slot="prompt-input-tools"]'), null);
});
