import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import React from 'react';

import { FileListContent } from '@/modules/chat/tools/ContentRenderers/FileListContent';
import { OneLineDisplay } from '@/modules/chat/tools/OneLineDisplay';

describe('read-only embedded tool displays', () => {
  it('shows a search path without rendering the result-jump link', () => {
    const markup = renderToStaticMarkup(
      React.createElement(OneLineDisplay, {
        toolName: 'Grep',
        label: 'Grep',
        value: 'ready_for_generation',
        secondary: 'in /workspace/source',
        action: 'jump-to-results',
        toolResult: { content: 'result' },
        toolId: 'tool-1',
        allowNavigation: false,
      }),
    );

    expect(markup).toContain('in /workspace/source');
    expect(markup).not.toContain('href="#tool-result-tool-1"');
  });

  it('renders file targets as text rather than workspace-opening buttons', () => {
    const oneLineMarkup = renderToStaticMarkup(
      React.createElement(OneLineDisplay, {
        toolName: 'Read',
        label: 'Read',
        value: '/workspace/source/paper.md',
        action: 'open-file',
        allowNavigation: false,
      }),
    );
    const fileListMarkup = renderToStaticMarkup(
      React.createElement(FileListContent, {
        files: ['/workspace/source/paper.md'],
        interactive: false,
      }),
    );

    expect(oneLineMarkup).toContain('paper.md');
    expect(oneLineMarkup).not.toContain('<button');
    expect(fileListMarkup).toContain('paper.md');
    expect(fileListMarkup).not.toContain('<button');
  });
});
