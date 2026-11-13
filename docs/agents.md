# AI agents

A coding agent can change UI code, but it can't see the result unless something shows it. facetshot gives an agent
tools that return how a screen looks on several devices, and a list of what looks wrong, in a form small enough for
its context.

## Connecting your agent

Each agent gets two things: facetshot's MCP server, which gives it the tools, and the skill, which tells it when to
look and how. The skill is a folder: `SKILL.md` (the workflow and the rules) and `references/` (every tool and
option, steps and flows, results and logs, each platform, and setup and troubleshooting), which the agent reads when
a task needs it. Install facetshot first ([Getting started](getting-started.md#1-install)), then set up your agent.

The server is registered as `bunx facetshot mcp`. That command uses facetshot from the project's `node_modules` if it
is there, then a global install, and otherwise downloads it, so it works for whoever clones the project.

### Claude Code

Install the plugin once, for all your projects:

```
/plugin install facetshot --marketplace Sung-eon/facetshot
```

Or write both into this project, so everyone who clones it gets them:

```sh
facetshot init --agent claude
```

This registers the server in `.mcp.json`, puts the skill in `.claude/skills/facetshot/` and adds
[one line](#the-line-in-claudemd-or-agentsmd) to `CLAUDE.md`. With the plugin, add that line to the project's
`CLAUDE.md` yourself. Short paths such as `/settings` also need a `facetshot.config.ts` (`facetshot init`).

### Codex

```sh
facetshot init --agent codex
```

This puts the skill in `.agents/skills/facetshot/`, where Codex looks for a repository's skills, and the server
under `[mcp_servers.facetshot]` in `.codex/config.toml`. Codex reads a project's config once you trust the project;
otherwise copy that section to `~/.codex/config.toml`.

### Cursor

```sh
facetshot init --agent cursor
```

This registers the server in `.cursor/mcp.json` and writes the rule `.cursor/rules/facetshot.mdc`. A rule is one
file, so it carries `SKILL.md` followed by every reference.

### Other agents

Any agent that can run a local MCP server over standard input and output can use facetshot: register the command
`bunx facetshot mcp` (the JSON is below). If the agent reads skills or instruction files, point it at the
`skills/facetshot/` folder of facetshot's install: `node_modules/facetshot/` in a project, or
`~/.bun/install/global/node_modules/facetshot/` after `bun add -g`.

`facetshot init --agent all` sets up Claude Code, Cursor and Codex at once.

Running `init` again is safe, but note what it does to each file:

- In `.mcp.json` and `.cursor/mcp.json`, only the `facetshot` entry is written; other servers are kept.
- In `.codex/config.toml`, the section is added only if there isn't one already.
- The skill folder is replaced each time. When facetshot sits inside your project (a clone or a monorepo), it is a
  symbolic link to facetshot's own `skills/facetshot/`, so it can't drift from the version you run.
- `.cursor/rules/facetshot.mdc` is overwritten each time.

`facetshot uninstall` takes out exactly these entries and files again ([`uninstall`](cli.md#uninstall)).

Commit these files, so everyone on the team, and every agent, gets the same setup.

`init --agent` connects the agent even in a folder where it finds no app to build or start: it writes no config then,
and the agent can still take screenshots of full URLs. To give it short paths like `/settings` for an app that's
already running, add its address: `facetshot init --url http://localhost:3000 --agent claude`.

### The line in CLAUDE.md or AGENTS.md

`init --agent` also adds one line to your `CLAUDE.md` or `AGENTS.md` (whichever exists, `CLAUDE.md` first; if neither
does, it creates `CLAUDE.md` for Claude Code and `AGENTS.md` otherwise). At a terminal it asks first, yes by default;
`--yes` adds it without asking; with no terminal and no `--yes` it only prints the line. It leaves a file that already
mentions facetshot alone. The line is:

> To see this app's screens or try what they do, use facetshot (the `facetshot` MCP tools, or the `facetshot`
> command) instead of a one-off screenshot script, and look before answering from the code.

Keep this line. Agents tend to answer from the code, or write a one-off screenshot script whose fixed sleeps make it
flaky. With the skill alone, many still do; with this line in their instructions, they look in the app first. Tests you
keep, such as Playwright's `toHaveScreenshot`, are a different job; edit the line if your agents should also write
those.

Restart your agent after `init`: agents load MCP servers when they start, and Claude Code asks you to approve the
`facetshot` server the first time. To check the connection, ask "which facetshot tools do you have?" or "check
/settings on a phone".

### Setting it up by hand

The MCP server is a local server that talks over standard input and output. When facetshot is installed in the
project, the entry is:

```json
{
	"mcpServers": {
		"facetshot": { "command": "bunx", "args": ["facetshot", "mcp"] }
	}
}
```

When facetshot is used from a clone, `init` writes `"command": "bun", "args": ["--bun", "<path to
facetshot>/src/cli.ts", "mcp"]` instead. The server looks for `facetshot.config.ts` from the folder it starts in; set
`FACETSHOT_CONFIG` or `FACETSHOT_CWD` to point it elsewhere ([environment variables](cli.md#environment-variables)).

## The tools

The README has [a one-line summary of each tool](../README.md#connecting-an-agent), and [MCP tools](mcp.md) lists
every parameter and what each tool returns.

## Recommended workflow

The skill teaches agents this workflow, and it works well for people too:

1. Look for what the project already has: `list` with `flows` and `profiles`. A profile with targets is a whole
   check someone has already written down.
2. Check the screens you touched. Most problems show up here, as text.
3. Capture the screens worth seeing, and read the sheets.
4. Fix, then compare to see only what changed.
5. Inspect a single screenshot when a detail is too small to read on the sheet.
6. Close every session you opened.

When the question is how the app looks or behaves ("what gets logged when I press Save?", "does the card overflow on
a phone?"), the agent should look in the app before it answers from the code, and say what it saw. The skill asks
for this, because agents otherwise often answer from the source alone.

When the agent doesn't know the steps to a state yet (what's in this menu, what happens after Save), a session lets
it look, decide and act one step at a time, and then save the steps as a flow that `capture` can play on every
device. Adding that flow to a profile's targets ([A batch to run again](flows.md#a-batch-to-run-again)) makes it part
of the check the next person or agent runs.

Two tips:

- Tell the agent which screens a change affects. "Check `/settings` and `/settings/billing` on phones" leads to a
  focused look; "check the app" leads to a lot of screenshots.
- Keep the `default` profile small. Two variants on four devices catch most layout problems day to day; before you
  finish a feature, use the built-in `full` profile (`-p full`, or `profile: "full"`), which adds large text.

## Keeping images cheap

Images take up most of an agent's context, so the tools return as few as they can:

- `check` returns no images at all, which makes it a good first step after a change.
- `capture` returns at most 4 sheets per call (`FACETSHOT_MCP_MAX_IMAGES`) and lists the rest by name. Each sheet
  shows every device and variant of one screen, about 1600 pixels wide.
- `compare` returns only the sheets that changed.
- `inspect` returns one screenshot scaled to fit 1568 pixels, or only the region asked for. Without a device and
  variant, it returns the screen's screenshots that failed, have problems or changed, at most 4. Use it to read small
  text instead of capturing at a larger size.

## Several agents at once

Every agent's MCP server and every terminal talks to the same background helper, so ten agents taking screenshots at
once share one browser and the same limits instead of starting ten browsers. See
[Shared limits](architecture.md#shared-limits).

## What an agent can do

The tools build your app, start its servers, make test data and sign in as your personas. Steps in `capture`, `check`,
`compare` and `act` can click anything a signed-in user could. Read [Security](security.md) before you let an agent
use facetshot against a live site or with real accounts.
