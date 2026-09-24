import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import ChatComposer from '@/modules/chat/composer/ChatComposer';

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/shared/utils')>(),
  IS_LLM4AD_EMBEDDED: true,
}));
vi.mock('@/modules/chat/hooks/useVoiceAvailable', () => ({ useVoiceAvailable: () => false }));

test('activity and stop controls follow the composer input container', () => {
  const noop = () => undefined;
  const props: React.ComponentProps<typeof ChatComposer> = {
    pendingPermissionRequests: [],
    handlePermissionDecision: noop,
    handleGrantToolPermission: () => ({ success: true }),
    activity: { statusText: 'Working', canInterrupt: true, startedAt: Date.now() },
    isLoading: true,
    onAbortSession: noop,
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
    tokenBudget: null,
    onShowTokenUsage: noop,
    slashCommandsCount: 0,
    onToggleCommandMenu: noop,
    hasInput: false,
    onClearInput: noop,
    onSubmit: noop,
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
  const activity = container.querySelector('.chat-activity-tab');
  const anchor = activity?.parentElement?.parentElement?.parentElement;

  assert.ok(input);
  assert.ok(activity);
  assert.equal(anchor?.parentElement, input.parentElement);
  assert.ok(anchor?.classList.contains('bottom-full'));
  assert.ok(anchor?.classList.contains('right-0'));
  assert.equal(container.querySelectorAll('.chat-activity-tab').length, 2);
});
