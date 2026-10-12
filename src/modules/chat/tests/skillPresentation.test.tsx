import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';

import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { Reasoning, ReasoningTrigger } from '@/modules/chat/transcript/Reasoning';
import { i18n } from '@/modules/i18n';

const originalLanguage = i18n.language;
afterAll(async () => { await i18n.changeLanguage(originalLanguage); });

function renderSkill(toolName: string, toolInput: Record<string, string>, completed = true) {
  return renderToStaticMarkup(
    <ToolRenderer
      toolName={toolName}
      toolInput={JSON.stringify(toolInput)}
      toolResult={completed ? { content: 'instructions' } : undefined}
      mode="input"
    />,
  );
}

describe('localized skill and process presentation', () => {
  it.each([
    ['en', 'Skill consulted', 'Source / call details', 'Process details'],
    ['zh-CN', '已参考技能', '来源与调用详情', '处理过程'],
  ])('shows a skill read and reasoning in %s', async (language, skillLabel, sourceLabel, processLabel) => {
    await i18n.changeLanguage(language);
    const skill = renderSkill('Read', { file_path: '/workspace/skills/auto-rebuttal/SKILL.md' });
    const reasoning = renderToStaticMarkup(<Reasoning><ReasoningTrigger /></Reasoning>);

    expect(skill).toContain(skillLabel);
    expect(skill).toContain('auto-rebuttal');
    expect(skill).toContain(sourceLabel);
    expect(skill).toContain('/workspace/skills/auto-rebuttal/SKILL.md');
    expect(reasoning).toContain(processLabel);
  });

  it('keeps a running Skill invocation visible with expandable call details', async () => {
    await i18n.changeLanguage('zh-CN');
    const markup = renderSkill('Skill', { skill: 'proposal-writing' }, false);

    expect(markup).toContain('正在参考技能');
    expect(markup).toContain('proposal-writing');
    expect(markup).toContain('<details');
    expect(markup).toContain('&quot;skill&quot;: &quot;proposal-writing&quot;');
  });

  it('labels failed skill access as a failure, not as completed', async () => {
    await i18n.changeLanguage('zh-CN');
    const markup = renderToStaticMarkup(
      <ToolRenderer
        toolName="Read"
        toolInput={JSON.stringify({ file_path: '/workspace/skills/auto-rebuttal/SKILL.md' })}
        toolResult={{ isError: true, content: 'Permission denied' }}
        mode="input"
      />,
    );

    expect(markup).toContain('技能读取失败');
    expect(markup).toContain('出错');
    expect(markup).not.toContain('已参考技能');
  });

  it.each([['en', 'Read'], ['zh-CN', '读取']])('localizes an ordinary file read in %s', async (language, label) => {
    await i18n.changeLanguage(language);
    const markup = renderSkill('Read', { file_path: '/workspace/paper.md' });
    expect(markup).toContain(label);
    expect(markup).toContain('paper.md');
    expect(markup).not.toContain('<details');
  });
});
