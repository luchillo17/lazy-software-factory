import { Context, Effect } from "effect";
import { GitHostError } from "./git-host.ts";

export interface GhRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GhRunnerService {
  /** Run a CLI in the adapter boundary (`gh`, `git`, …). */
  readonly run: (options: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  }) => Effect.Effect<GhRunResult, GitHostError>;
}

/** Injectable CLI boundary for forge adapters. */
export class GhRunner extends Context.Service<GhRunner, GhRunnerService>()(
  "@lazy-software-factory/git-host/GhRunner"
) {}
