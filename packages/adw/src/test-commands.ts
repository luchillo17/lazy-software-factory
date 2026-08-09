import { Context } from "effect";

/** Coded Test agent commands (ADR-0005) — sandbox `exec` argv[0] + rest. */
export class AdwTestCommands extends Context.Service<
  AdwTestCommands,
  {
    readonly commands: ReadonlyArray<{
      readonly command: string;
      readonly args?: readonly string[];
    }>;
  }
>()("@lazy-software-factory/adw/AdwTestCommands") {}
