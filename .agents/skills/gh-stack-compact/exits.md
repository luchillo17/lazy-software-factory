# gh-stack-compact exits

Load when `gh stack` returns non-zero and the next move is unclear.

| Code | Next                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | read stderr; fix; retry                                                                                                                                                                   |
| 2    | not in a stack → join via `checkout <pr-or-stack#>` (after `unstack --local` if tracking conflicts) or grow via `init`                                                                    |
| 3    | rebase conflict → in progress: fix → `gh stack rebase --continue` → `gh stack push`; after failed `sync` (branches restored, no markers): `gh stack rebase` → fix → `--continue` → `push` |
| 4    | GitHub API → `gh auth status`; retry                                                                                                                                                      |
| 5    | bad args → fix invocation                                                                                                                                                                 |
| 6    | branch in multiple stacks → `checkout <non-shared-branch>` (arg required)                                                                                                                 |
| 7    | rebase in progress → `--continue` or `--abort`                                                                                                                                            |
| 8    | stack locked → wait ~5s; retry                                                                                                                                                            |
| 9    | stacked PRs disabled on repo → stop; tell user                                                                                                                                            |
| 10   | `modify` interrupted → `gh stack modify --abort` (this skill never starts `modify`)                                                                                                       |

Status → stderr. `--json` → stdout.
