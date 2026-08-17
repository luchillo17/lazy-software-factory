/**
 * `adw-host` entry: inject invoker cwd when needed, then run Host Minimal ADW
 * via Factory checkout toolchain / workspace packages.
 *
 * Invoked by `bin/adw-host.mjs` with process cwd still the invoker directory and
 * `ADW_HOST_INVOKER_CWD` set to that same directory (absolute `--cwd` injection).
 */
import { prepareAdwHostArgv } from "../packages/adw/src/host-operator.ts";

const invokerCwd =
  process.env["ADW_HOST_INVOKER_CWD"] !== undefined &&
  process.env["ADW_HOST_INVOKER_CWD"] !== ""
    ? process.env["ADW_HOST_INVOKER_CWD"]
    : process.cwd();

delete process.env["ADW_HOST_INVOKER_CWD"];

const prepared = prepareAdwHostArgv(
  process.argv.slice(2),
  invokerCwd,
  process.env
);
process.argv = [process.argv[0]!, process.argv[1]!, ...prepared];

await import("./run-minimal-adw.ts");
