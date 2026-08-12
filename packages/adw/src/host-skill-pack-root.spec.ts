import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  hostAdwReviewSkillExists,
  hostSkillPackRoot,
} from "./host-skill-pack-root.ts";

describe("Host skill pack", () => {
  it.effect("bundles /adw-review under packages/adw/host-skill-pack", () =>
    Effect.sync(() => {
      assert.isTrue(hostSkillPackRoot.includes("host-skill-pack"));
      assert.isTrue(hostAdwReviewSkillExists());
    })
  );
});
