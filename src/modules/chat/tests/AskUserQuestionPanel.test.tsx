import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

test('lets question options grow naturally until the panel reaches its viewport limit', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);

  const { container } = render(
    <AskUserQuestionPanel
      request={{
        requestId: 'question-1',
        toolName: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which direction should we take?',
              options: Array.from({ length: 8 }, (_, index) => ({
                label: `Option ${index + 1}`,
              })),
            },
          ],
        },
      }}
      onDecision={() => {}}
    />,
  );

  const panel = container.querySelector('[data-slot="ask-user-question-panel"]');
  const options = container.querySelector('[data-slot="ask-user-question-options"]');

  assert.ok(panel?.classList.contains('max-h-[70dvh]'));
  assert.ok(options?.classList.contains('min-h-0'));
  assert.ok(options?.classList.contains('overflow-y-auto'));
  assert.ok(!options?.classList.contains('max-h-48'));
});
