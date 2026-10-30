import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { EmbeddedPreferenceControls } from '@/modules/chat/composer/EmbeddedPreferenceControls';
import { updateEmbeddedHostContext } from '@/shared/embeddedHostContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

test('conversation preferences are edited inline and sent separately from the model binding', () => {
  updateEmbeddedHostContext({
    modelBinding: {
      provider_id: 'a',
      model_name: 'Sonnet',
      context_window_tokens: 128000,
      max_output_tokens: 16000,
    },
    conversationPreferences: {
      reply_language: 'auto',
      additional_guidance: '',
    },
  });
  const post = vi.spyOn(window.parent, 'postMessage');
  render(<EmbeddedPreferenceControls disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'composer.preferences' }));
  fireEvent.click(screen.getByRole('button', { name: 'composer.language.zh' }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Explain suggestions clearly' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'composer.apply' }));
  expect(post).toHaveBeenCalledWith(
    {
      type: 'llm4ad:update-preferences',
      preferences: {
        reply_language: 'zh',
        additional_guidance: 'Explain suggestions clearly',
      },
    },
    window.location.origin,
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});
