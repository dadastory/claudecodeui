import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  updateEmbeddedHostContext,
  useEmbeddedHostContext,
} from '@/shared/embeddedHostContext';

describe('embedded host context', () => {
  beforeEach(() => {
    updateEmbeddedHostContext({
      stageTitle: '',
      stageDescription: '',
      stageExamples: [],
    });
  });

  it('normalizes the stage guidance supplied by the host page', () => {
    const { result } = renderHook(() => useEmbeddedHostContext());

    act(() => {
      updateEmbeddedHostContext({
        stageTitle: '  Literature & Evidence  ',
        stageDescription: '  Build a traceable evidence base.  ',
        stageExamples: ['  Compare Method A and Method B.  ', '', 42, 'Check every citation.'],
      });
    });

    expect(result.current).toEqual({
      stageTitle: 'Literature & Evidence',
      stageDescription: 'Build a traceable evidence base.',
      stageExamples: ['Compare Method A and Method B.', 'Check every citation.'],
    });
  });

  it('limits conversation starters to three bounded strings', () => {
    const { result } = renderHook(() => useEmbeddedHostContext());
    const longExample = 'x'.repeat(700);

    act(() => {
      updateEmbeddedHostContext({
        stageExamples: [longExample, 'second', 'third', 'fourth'],
      });
    });

    expect(result.current.stageExamples).toHaveLength(3);
    expect(result.current.stageExamples[0]).toHaveLength(600);
    expect(result.current.stageExamples).not.toContain('fourth');
  });
});
