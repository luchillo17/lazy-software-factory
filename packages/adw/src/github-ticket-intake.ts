import {
  GhRunner,
  GhRunnerLive,
  type GhRunResult,
} from "@lazy-software-factory/git-host";
import { Effect, Layer, Schema } from "effect";
import {
  TicketIntake,
  TicketIntakeError,
  type ReadyTicket,
} from "./ticket-intake.ts";

/** Labels that gate Issue intake into Minimal ADW. */
export const ReadyTicketLabel = {
  ReadyForAgent: "ready-for-agent",
} as const;

export const ReadyTicketLabelSchema = Schema.Enum(ReadyTicketLabel);
export type ReadyTicketLabel = typeof ReadyTicketLabelSchema.Type;

const GhIssueView = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
});

export interface ParsedIssueRef {
  readonly number: string;
  readonly repo?: string;
}

/** Parse Issue number, `#N`, or GitHub Issues URL. */
export const parseGitHubIssueRef = (
  ref: string
): ParsedIssueRef | { readonly error: string } => {
  const trimmed = ref.trim();
  if (!trimmed) {
    return { error: "Empty Issue reference" };
  }

  const urlMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)(?:[/?#]|$)/i
  );
  if (urlMatch) {
    return { number: urlMatch[2]!, repo: urlMatch[1]! };
  }

  const hashMatch = trimmed.match(/^#?(\d+)$/);
  if (hashMatch) {
    return { number: hashMatch[1]! };
  }

  return {
    error: `Unrecognized Issue reference: ${trimmed} (use number, #N, or Issues URL)`,
  };
};

const requireZero = (
  result: GhRunResult,
  label: string
): Effect.Effect<void, TicketIntakeError> =>
  result.exitCode === 0
    ? Effect.void
    : Effect.fail(
        new TicketIntakeError({
          message: `${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
        })
      );

const toPrompt = (title: string, body: string | null): string => {
  const text = (body ?? "").trim();
  return text.length > 0 ? `# ${title}\n\n${text}` : `# ${title}`;
};

/** GitHub Issues adapter for {@link TicketIntake} (via `gh`). */
export const GitHubTicketIntake = Layer.effect(
  TicketIntake,
  Effect.gen(function* () {
    const cli = yield* GhRunner;

    return TicketIntake.of({
      loadReadyTicket: (ref) =>
        Effect.gen(function* () {
          const parsed = parseGitHubIssueRef(ref);
          if ("error" in parsed) {
            return yield* new TicketIntakeError({ message: parsed.error });
          }

          const args = [
            "issue",
            "view",
            parsed.number,
            "--json",
            "number,title,body,labels",
          ];
          if (parsed.repo) {
            args.push("-R", parsed.repo);
          }

          const viewed = yield* cli.run({ command: "gh", args }).pipe(
            Effect.mapError(
              (err) =>
                new TicketIntakeError({
                  message: `gh issue view failed: ${err.message}`,
                  cause: err,
                })
            )
          );
          yield* requireZero(viewed, `gh issue view ${parsed.number}`);

          const raw = yield* Effect.try({
            try: () => JSON.parse(viewed.stdout) as unknown,
            catch: (cause) =>
              new TicketIntakeError({
                message: `Invalid gh issue view JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
                cause,
              }),
          });

          const decoded = yield* Schema.decodeUnknownEffect(GhIssueView)(
            raw
          ).pipe(
            Effect.mapError(
              (err) =>
                new TicketIntakeError({
                  message: `Invalid gh issue view JSON: ${err.message}`,
                  cause: err,
                })
            )
          );

          const labelNames = decoded.labels.map((l) => l.name);
          if (!labelNames.includes(ReadyTicketLabel.ReadyForAgent)) {
            return yield* new TicketIntakeError({
              message: `Issue #${decoded.number} is not labelled ${ReadyTicketLabel.ReadyForAgent} (labels: ${labelNames.join(", ") || "none"})`,
            });
          }

          const ready: ReadyTicket = {
            ticketId: String(decoded.number),
            prompt: toPrompt(decoded.title, decoded.body),
          };
          return ready;
        }),
    });
  })
);

/** GitHub Issues TicketIntake with live `gh` process runner. */
export const GitHubTicketIntakeLive = GitHubTicketIntake.pipe(
  Layer.provide(GhRunnerLive)
);
