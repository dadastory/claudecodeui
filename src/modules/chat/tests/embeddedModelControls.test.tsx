import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmbeddedModelControls } from '@/modules/chat/composer/EmbeddedModelControls';
import { updateEmbeddedHostContext } from '@/shared/embeddedHostContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const binding = {
  provider_id: 'a',
  model_name: 'Sonnet',
  context_window_tokens: 128000,
  max_output_tokens: 16000,
};
const options = [
  { provider_id: 'a', provider_name: 'Lab', model_name: 'Sonnet' },
  { provider_id: 'b', provider_name: 'Gateway', model_name: 'GPT' },
];

describe('embedded platform model controls', () => {
  beforeEach(() => {
    updateEmbeddedHostContext({ modelBinding: binding, modelOptions: options });
  });

  it('opens a searchable provider-grouped list and sends the exact choice to the host', () => {
    const post = vi.spyOn(window.parent, 'postMessage');
    render(<EmbeddedModelControls disabled={false} />);
    expect(screen.getByText('Sonnet')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'composer.platformModel' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Lab')).toBeTruthy();
    expect(screen.getByText('Gateway')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'gateway' },
    });
    expect(screen.queryByText('Lab')).toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT' }));
    expect(post).toHaveBeenCalledWith(
      {
        type: 'llm4ad:update-model-binding',
        binding: { ...binding, provider_id: 'b', model_name: 'GPT' },
      },
      window.location.origin,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    // The current model changes only after the host confirms its saved binding.
    expect(screen.getByText('Sonnet')).toBeTruthy();
    act(() =>
      updateEmbeddedHostContext({
        modelBinding: { ...binding, provider_id: 'b', model_name: 'GPT' },
        modelOptions: options,
      }),
    );
    expect(screen.getByText('GPT')).toBeTruthy();
  });

  it('edits token settings beside the model and rejects inconsistent values', () => {
    const post = vi.spyOn(window.parent, 'postMessage');
    render(<EmbeddedModelControls disabled={false} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'composer.contextSettings' }),
    );
    const context = screen.getByRole('spinbutton', {
      name: 'composer.contextWindow',
    });
    fireEvent.change(context, { target: { value: '8192' } });
    expect(
      (
        screen.getByRole('button', {
          name: 'composer.apply',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(context, { target: { value: '64000' } });
    fireEvent.click(screen.getByRole('button', { name: 'composer.apply' }));
    expect(post).toHaveBeenCalledWith(
      {
        type: 'llm4ad:update-model-binding',
        binding: { ...binding, context_window_tokens: 64000 },
      },
      window.location.origin,
    );
  });

  it('disables changes while replying or saving and retains the saved model on errors', () => {
    const { rerender } = render(<EmbeddedModelControls disabled />);
    expect(
      (
        screen.getByRole('button', {
          name: 'composer.platformModel',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    rerender(<EmbeddedModelControls disabled={false} />);
    act(() =>
      updateEmbeddedHostContext({
        modelBinding: binding,
        modelOptions: options,
        modelUpdating: true,
      }),
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'composer.contextSettings',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    act(() =>
      updateEmbeddedHostContext({
        modelBinding: binding,
        modelOptions: options,
        modelError: 'Try again',
      }),
    );
    expect(screen.getByText('Sonnet')).toBeTruthy();
  });
});
