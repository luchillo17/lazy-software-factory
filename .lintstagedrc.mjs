/**
 * lint-staged → Nx Prettier (`nx format:write`).
 * Nx wants `--files=a,b`; it does not take positional paths.
 */
export default {
  "*": (filenames) =>
    filenames.length === 0
      ? []
      : [`pnpm nx format:write --files=${filenames.join(",")}`],
};
