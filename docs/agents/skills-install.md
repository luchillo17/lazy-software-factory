# Skills install (multi-agent)

Canonical skill bodies live under `.agents/skills/`. Claude Code reads `.claude/skills/`. Other agents that share the canonical dir (Cursor, Codex, Gemini CLI, GitHub Copilot, OpenCode) do not need a second tree.

## Install / re-link

Project scope (no `-g`). Always pass **Claude Code and Cursor** together so the Skills CLI keeps **symlink** mode:

```bash
npx skills add <owner/repo> --agent claude-code cursor -y
```

Examples:

```bash
npx skills add juliusbrussee/caveman --agent claude-code cursor -y
npx skills add fallow-rs/fallow-skills --agent claude-code cursor -y
npx skills add mattpocock/skills --agent claude-code cursor -y
npx skills add luchillo17/gh-stack-compact --agent claude-code cursor -y
```

Verify: every entry under `.claude/skills/` is a symlink to `../../.agents/skills/<name>`, not a real directory of files.

```bash
ls -la .claude/skills
find .claude/skills -mindepth 1 -maxdepth 1 ! -type l
```

The `find` command must print nothing. Lockfile: `skills-lock.json`.

## Why two agents

The Skills CLI sets install mode to **copy** when every target agent shares one `skillsDir` (`uniqueDirs.size <= 1`). `--agent claude-code` alone only targets `.claude/skills`, so it copies. Passing Cursor (canonical `.agents/skills`) plus Claude Code makes `uniqueDirs.size > 1` and keeps **symlink** mode. Prefer that over a hand-rolled `ln -s` loop unless the CLI cannot run.

Do not pass `--copy` for this repo.
