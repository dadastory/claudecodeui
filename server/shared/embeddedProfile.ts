import fs from 'node:fs/promises';
import path from 'node:path';

type EmbeddedRuntimeProfile = {
  sessionId: string;
  model: string;
  env?: Record<string, string>;
  skills?: string[];
  mcpServers?: Record<string, unknown>;
  toolsSettings?: {
    allowedTools?: string[];
    disallowedTools?: string[];
    skipPermissions?: boolean;
  };
  permissionMode?: string;
  systemPromptAppend?: string;
  contextWindowTokens?: number;
  workspaceRoot?: string;
  /**
   * Roots a research stage may read from, in addition to `workspaceRoot`.
   *
   * Reading and writing are not the same boundary. A stage may only *write*
   * its assigned source paths, but it has to *read* far more than that to do
   * the work at all: the earlier stages' output it is building on, the skill
   * files that carry its method, the persisted session, and the project
   * documents the runtime hands it. Those live in different trees from the
   * source, so a single root would either block the work or leave writes
   * unbounded.
   */
  readableRoots?: string[];
  writablePaths?: string[];
};

const profiles = new Map<string, EmbeddedRuntimeProfile>();
const SAFE_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,127}$/;

export function setEmbeddedRuntimeProfile(profile: EmbeddedRuntimeProfile): void {
  profiles.set(profile.sessionId, structuredClone(profile));
}

export function getEmbeddedRuntimeProfile(sessionId: unknown): EmbeddedRuntimeProfile | null {
  if (typeof sessionId !== 'string') {
    return null;
  }
  return profiles.get(sessionId) ?? null;
}

export async function installEmbeddedSkills(skillNames: string[]): Promise<string> {
  const skillSourceRoot = path.resolve(process.env.LLM4AD_SKILLS_ROOT || '/app/skills');
  const configRoot = path.resolve(process.env.LLM4AD_CLAUDE_CONFIG_DIR || '/workspace/.cloudcli/.claude');
  const destinationRoot = path.join(configRoot, 'skills');
  await fs.rm(destinationRoot, { recursive: true, force: true });
  await fs.mkdir(destinationRoot, { recursive: true });

  for (const skillName of skillNames) {
    if (!SAFE_SKILL_NAME.test(skillName)) {
      throw new Error(`Invalid embedded Skill name: ${skillName}`);
    }
    const source = path.resolve(skillSourceRoot, skillName);
    if (path.dirname(source) !== skillSourceRoot) {
      throw new Error(`Embedded Skill escapes the configured root: ${skillName}`);
    }
    await fs.cp(source, path.join(destinationRoot, skillName), { recursive: true });
  }

  return configRoot;
}

export type { EmbeddedRuntimeProfile };
