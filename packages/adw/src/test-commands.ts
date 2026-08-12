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
    /**
     * Resolve gates for the sandbox cwd (Host: target `package.json` scripts).
     * Empty array → ADW fails before Test (no silent green).
     */
    readonly resolve: (cwd: string) => ReadonlyArray<AdwTestCommand>;
  }
>()("@lazy-software-factory/adw/AdwTestCommands") {}
