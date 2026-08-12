import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Monorepo root from `packages/adw/src` (Skill pack lives here).
 * Shared by ADW specs so fake Host sandboxes see `.agents/skills`.
 */
export const monorepoRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../.."
);
