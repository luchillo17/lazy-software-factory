import { Context } from "effect";

/** One check-only Test agent command (argv[0] + rest). */
export type AdwTestCommand = {
  readonly command: string;
  readonly args?: readonly string[];
};

/** Coded Test agent commands (ADR-0005, ADR-0013) — check-only sandbox execs. */
export class AdwTestCommands extends Context.Service<
  AdwTestCommands,
  {
    /** Read-only check gates; orchestration runs them in parallel. */
    readonly commands: ReadonlyArray<AdwTestCommand>;
  }
>()("@lazy-software-factory/adw/AdwTestCommands") {}
