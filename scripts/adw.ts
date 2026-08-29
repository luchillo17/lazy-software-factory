/**
 * Provider-neutral Minimal ADW operator (`adw`).
 * Default sandbox is docker; Host via `--sandbox host` or `adw-host`.
 */
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { operatorMainEffect } from "../packages/adw/src/operator-cli.ts";

NodeRuntime.runMain(
  operatorMainEffect(process.argv.slice(2)).pipe(
    Effect.tap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      })
    ),
    Effect.asVoid
  ),
  { disableErrorReporting: true }
);
