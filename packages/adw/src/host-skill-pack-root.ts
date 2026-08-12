import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SKILL_PACK_ROOT, ReviewSkill } from "./role-skill-binding.ts";

/**
 * Host CLI bundled skill pack root (`packages/adw/host-skill-pack`).
 * Layout mirrors a repo root so Cursor workspace `dirs` discovers
 * `.agents/skills/adw-review` without requiring that skill on target cwd.
 */
export const hostSkillPackRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../host-skill-pack"
);

/** Whether bundled `/adw-review` is on disk under the Host skill pack. */
export const hostAdwReviewSkillExists = (
  root: string = hostSkillPackRoot
): boolean =>
  existsSync(
    join(root, DEFAULT_SKILL_PACK_ROOT, ReviewSkill.AdwReview, "SKILL.md")
  );
