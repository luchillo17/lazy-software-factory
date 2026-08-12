import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { monorepoRoot } from "./monorepo-root.ts";
import {
  AgentRole,
  BuildSkill,
  DEFAULT_SKILL_PACK_ROOT,
  ReviewSkill,
  bootstrapRoleSkillPrompt,
  skillPackRootExists,
} from "./role-skill-binding.ts";

describe("Role skill binding bootstrap", () => {
  it.effect(
    "Build prompt injects /implement only (no closure / setup-matt)",
    () =>
      Effect.sync(() => {
        const prompt = bootstrapRoleSkillPrompt(
          AgentRole.Build,
          "Ship ticket T-1"
        );
        assert.isTrue(prompt.includes(`/${BuildSkill.Implement}`));
        assert.isTrue(prompt.includes(DEFAULT_SKILL_PACK_ROOT));
        assert.isTrue(prompt.includes("Ship ticket T-1"));
        assert.isFalse(prompt.includes("AGENTS.md"));
        assert.isFalse(prompt.includes("setup-matt-pocock-skills"));
        assert.isFalse(prompt.includes("transitive"));
        assert.isFalse(prompt.includes("You are the Build agent"));
        assert.isFalse(prompt.includes("Role skill binding"));
        assert.isFalse(prompt.includes(`/${BuildSkill.Tdd}`));
        assert.isFalse(prompt.includes(`/${BuildSkill.CodeReview}`));
        assert.isFalse(prompt.includes(`/${BuildSkill.CodebaseDesign}`));
        assert.isFalse(prompt.includes(`/${ReviewSkill.AdwReview}`));
      })
  );

  it.effect("Review prompt injects /adw-review only", () =>
    Effect.sync(() => {
      const prompt = bootstrapRoleSkillPrompt(
        AgentRole.Review,
        "Review changes for ticket T-1"
      );
      assert.isTrue(prompt.includes(`Use \`/${ReviewSkill.AdwReview}\``));
      assert.isTrue(prompt.includes("Review changes for ticket T-1"));
      assert.isTrue(prompt.includes(DEFAULT_SKILL_PACK_ROOT));
      assert.isFalse(prompt.includes("AGENTS.md"));
      assert.isFalse(prompt.includes("Bugbot-shaped"));
      assert.isFalse(prompt.includes("setup-matt-pocock-skills"));
      assert.isFalse(prompt.includes(`/${BuildSkill.Implement}`));
      assert.isFalse(prompt.includes(`/${BuildSkill.CodeReview}`));
      assert.isFalse(prompt.includes("improve-codebase-architecture"));
      assert.isFalse(prompt.includes("review-bugbot"));
    })
  );

  it.effect(
    "skillPackRootExists requires pack on cwd (not only ancestor)",
    () =>
      Effect.sync(() => {
        assert.isTrue(skillPackRootExists(monorepoRoot));
        assert.isFalse(skillPackRootExists(join(monorepoRoot, "packages/adw")));
        assert.isFalse(skillPackRootExists("/tmp/no-such-adw-pack-root-38"));
      })
  );
});
