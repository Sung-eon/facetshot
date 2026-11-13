# AI agents

A coding agent can change UI code, but it can't see the result unless something shows it. facetshot gives an agent
tools that return how a screen looks on several devices, and a list of what looks wrong, in a form small enough for
its context.

## Connecting your agent

Run one of these in your project's folder:

```sh
bunx facetshot init --agent claude     # Claude Code
bunx facetshot init --agent cursor     # Cursor
bunx facetshot init --agent codex      # Codex
bunx facetshot init --agent all
```

What each one writes:

| Agent       | File                          | What it is                                                                                                                                                     |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `.mcp.json`                   | registers facetshot's MCP server, so the agent gets its tools                                                                                                  |
|             | `.claude/skills/facetshot/`   | the Agent Skill: `SKILL.md` says when to look and how; `reference.md` has the details                                                                          |
| Cursor      | `.cursor/mcp.json`            | the same MCP server, for Cursor                                                                                                                                |
|             | `.cursor/rules/facetshot.mdc` | the skill's text as a Cursor rule                                                                                                                              |
| Codex       | `.codex/config.toml`          | the MCP server, under `[mcp_servers.facetshot]`. Codex reads a project's file once you trust the project; otherwise copy the section to `~/.codex/config.toml` |
|             | `.agents/skills/facetshot/`   | the Agent Skill, where Codex looks for a repository's skills                                                                                                   |

Running `init` again is safe, but note what it does to each file:

- In `.mcp.json` and `.cursor/mcp.json`, only the `facetshot` entry is written; other servers are kept.
- In `.codex/config.toml`, the section is added only if there isn't one already.
- The skill folder is replaced each time. When facetshot sits inside your project (a clone or a monorepo), it is a
  symbolic link to facetshot's own `skills/facetshot/`, so it can't drift from the version you run.
- `.cursor/rules/facetshot.mdc` is overwritten each time.

Commit these files, so everyone on the team, and every agent, gets the same setup.

`init --agent` connects the agent even in a folder where it finds no app to build or start: it writes no config then,
and the agent can still take screenshots of full URLs. To give it short paths like `/settings` for an app that's
already running, add its address: `bunx facetshot init --url http://localhost:3000 --agent claude`.

`init` also prints one line to add to your `CLAUDE.md` or `AGENTS.md`. With `--yes`, it appends the line to whichever
of those files already exists (`CLAUDE.md` first); it never creates one. The line is:

> To see this app's screens or try what they do, use facetshot (the `facetshot` MCP tools, or the `facetshot`
> command) instead of a one-off screenshot script, and look before answering from the code.

Agents tend to write a one-off screenshot script each time they want to see a screen, and the fixed sleeps in those
scripts make them flaky. The skill and this line tell them to use facetshot instead. Tests you keep, such as
Playwright's `toHaveScreenshot`, are a different job; edit the line if your agents should also write those.

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
