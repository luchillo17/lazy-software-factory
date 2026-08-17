# Host-on-foreign-cwd before classic Docker in the vision cut

Name **Host-on-foreign-cwd** (`adw-host` + `--cwd`) in [`VISION.md`](../VISION.md) **before** the classic Docker parallel-sandbox seam. Docker stays the v1 parallel / hosted multi-org **compute** hard gate (#29 / ADR-0008). This is post-v0 Host operator packaging — aim one Host Minimal ADW at another git tree without Docker and without npm publish — not a substitute for Docker concurrency or isolation. Glossary: **Host sandbox** / **Workspace provision** in [`CONTEXT.md`](../../CONTEXT.md).

## Status

accepted

## Consequences

- Readers of the vision cut see Host foreign-cwd packaging before Docker; §3 v0 green bar is unchanged.
- #29 Docker green bar and hosted-compute hard gate stay authoritative; do not read §4 as replacing them.
- Operator docs (`host-self-build`, `extractability`) own how-to + `--repo-url` footgun; this ADR only records sequencing.

## Considered Options

- **Leave Docker as the next named cut after v0** — rejected; operators already need foreign-cwd Host before parallel sandboxes, and “v1 = Docker” misreads the compatibility path.
- **Treat foreign-cwd as part of the §3 v0 green bar** — rejected; v0 self-build on this repo is already green; this slice is post-v0 Host surface.
- **Weaken or replace the Docker hard gate** — rejected; hosted multi-org compute still waits on classic Docker green (#29).
