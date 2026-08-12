import { existsSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

/** Configured Agent roles that carry a Role skill binding in Minimal ADW. */
export const AgentRole = {
  Build: "build",
  Review: "review",
} as const;

export const AgentRoleSchema = Schema.Enum(AgentRole);
export type AgentRole = typeof AgentRoleSchema.Type;

/** Default Skill pack root for this Factory (CONTEXT / VISION). */
export const DEFAULT_SKILL_PACK_ROOT = ".agents/skills";

/**
 * Skills named at call sites for Build prompt policy.
 * Build roots `/implement` only — closure lives inside that skill on disk.
 */
export const BuildSkill = {
  Implement: "implement",
  Tdd: "tdd",
  CodeReview: "code-review",
  CodebaseDesign: "codebase-design",
} as const;

export const BuildSkillSchema = Schema.Enum(BuildSkill);
export type BuildSkill = typeof BuildSkillSchema.Type;

/** Review Role skill binding root (Factory skill; not Cursor `/review-bugbot`). */
export const ReviewSkill = {
  AdwReview: "adw-review",
} as const;

export const ReviewSkillSchema = Schema.Enum(ReviewSkill);
export type ReviewSkill = typeof ReviewSkillSchema.Type;

const skillRef = (skill: string) => `\`/${skill}\``;

const buildBootstrapPreamble = (skillPackRoot: string) =>
  [
    `Skill pack root on cwd: \`${skillPackRoot}\` (must be present on disk).`,
    "",
    `Use ${skillRef(BuildSkill.Implement)} for this work.`,
    "",
    "## Work",
    "",
  ].join("\n");

const reviewBootstrapPreamble = (_skillPackRoot: string) =>
  [
    `Use ${skillRef(ReviewSkill.AdwReview)} for this work (Factory Host skill pack — injected via agent workspace dirs; need not live on target cwd).`,
    "",
    "## Work",
    "",
  ].join("\n");

const preambleForRole = (
  role: typeof AgentRoleSchema.Type,
  skillPackRoot: string
): string => {
  switch (role) {
    case AgentRole.Build:
      return buildBootstrapPreamble(skillPackRoot);
    case AgentRole.Review:
      return reviewBootstrapPreamble(skillPackRoot);
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
};

/**
 * Inject Role skill binding guidance ahead of the session work prompt.
 * Invented in ADW prompts — Cursor SDK has no skills API.
 * Prompt stays flat (skills + work); "role" is orchestration-only.
 */
export const bootstrapRoleSkillPrompt = (
  role: typeof AgentRoleSchema.Type,
  userPrompt: string,
  options?: { readonly skillPackRoot?: string }
): string => {
  const skillPackRoot = options?.skillPackRoot ?? DEFAULT_SKILL_PACK_ROOT;
  return `${preambleForRole(role, skillPackRoot)}${userPrompt}`;
};

/** Whether the Skill pack root directory exists directly under `cwd`. */
export const skillPackRootExists = (
  cwd: string,
  skillPackRoot: string = DEFAULT_SKILL_PACK_ROOT
): boolean => existsSync(join(cwd, skillPackRoot));
