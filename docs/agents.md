# AI agents

Coding agents are good at changing UI code and bad at knowing what it looks like afterwards. facetshot gives them
eyes: one call returns how a screen looks on every device that matters, plus a list of what's broken, in a form small
enough to fit in the agent's context.

## Connecting your agent

```sh
npx facetshot init --agent claude     # Claude Code
npx facetshot init --agent cursor     # Cursor
npx facetshot init --agent codex      # Codex
npx facetshot init --agent all
```

What this does:

| Agent       | MCP server                                       | Instructions                          |
| ----------- | ------------------------------------------------ | ------------------------------------- |
| Claude Code | added to `.mcp.json`                             | skill in `.claude/skills/facetshot/`  |
| Cursor      | added to `.cursor/mcp.json`                      | rule in `.cursor/rules/facetshot.mdc` |
| Codex       | printed for you to add to `~/.codex/config.toml` | skill in `.agents/skills/facetshot/`  |

It also suggests one line for your `AGENTS.md` or `CLAUDE.md`; pass `--yes` to add it. Commit these files so
everyone on the team, and every agent, gets the same setup.

To set it up by hand, the MCP server is a local stdio server:

```json
{
	"mcpServers": {
		"facetshot": { "command": "npx", "args": ["facetshot", "mcp"] }
	}
}
```

It looks for `facetshot.config.ts` from the folder it's started in. Set `FACETSHOT_CONFIG` to point it elsewhere.

## The tools

facetshot exposes five tools. Few, small tools are deliberate: every tool's description sits in the agent's context
on every turn.

| Tool      | What it does                                                  | Returns                                               |
| --------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `check`   | reads screens for problems without taking pictures            | a text list of problems                               |
| `capture` | takes pictures on the given (or default) devices and variants | a summary and one contact sheet per screen, as images |
| `compare` | repeats the last capture (or the targets given) and compares  | only the sheets that changed                          |
| `inspect` | one picture at full size, or a region of it                   | an image and that picture's problems                  |
| `list`    | devices, variants, profiles, checks, recent runs              | text                                                  |

Every tool takes targets the same way the command line does (`/path`, `app:/path`, `story:…`, `preview:…`, a flow
file) and optional `devices` and `variants`. `capture` and `check` also take `steps` — clicks, typing and waits played
before the picture, written as on the command line (`"click:role=button[name='Delete']"`, `"shot:confirm"`) — so an
agent can look at a menu or a dialog without writing a flow file.

`capture` can hand pictures back three ways, chosen with `images`:

| `images`           | Returns                                             | Use it for                                                           |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| `sheets` (default) | one grid per screen                                 | seeing how a screen holds up everywhere                              |
| `cells`            | each picture on its own, up to 8, scaled to 1024 px | a few cells where details matter                                     |
| `none`             | paths only                                          | when the agent's client shows files itself, or only the text matters |

Long runs report progress as they go, so an agent (and you, watching it) can see it's working.

## Keeping it cheap

Images are the expensive part of an agent's context, so facetshot is careful with them:

- `check` returns no images at all. It's the right first step after a change.
- `capture` returns at most 4 sheets per call (set `FACETSHOT_MCP_MAX_IMAGES` to change that) and lists the rest by
  name. Each sheet shows every device and variant of one screen, scaled to about 1600 pixels wide.
- `compare` returns only the sheets that changed.
- `inspect` returns one picture, scaled to fit 1568 pixels, or just the region asked for — use it to read small text
  instead of capturing at a larger size.

## The loop that works

The skill teaches agents this loop, and it's the one we recommend for people too:

1. **Check** the screens you touched. Most problems show up here, as text.
2. **Capture** the screens worth seeing, and read the sheets.
3. **Fix**, then **compare** to see only what changed.
4. **Inspect** a single picture when a detail is too small on the sheet.

Two things make agents noticeably better at this:

- **Tell them which screens a change affects.** "Check `/settings` and `/settings/billing` on phones" leads to a
  focused look; "check the app" leads to a lot of pictures.
- **Keep `default` small and make a `full` profile.** Day to day, two variants on four devices catch most layout
  problems; before you finish a feature, `-p full` adds large text.

## Several agents at once

Every agent's MCP server and every terminal talks to the same background helper, which keeps one browser and
enforces the machine's limits (four pages, two simulators, one heavy build at a time). Ten agents taking pictures at
once queue for those, rather than starting ten browsers. See [Speed and machine safety](performance.md).

## Telling agents not to write their own scripts

Agents left alone tend to write a fresh Playwright script for every screenshot — log in, wait, take the picture —
which is slow and gets the waiting wrong. The skill tells them not to; one line in your `AGENTS.md` or `CLAUDE.md`
makes it stick:

> To see screens, use facetshot (MCP tools `check`, `capture`, `compare`, or the `facetshot` command); never write a
> screenshot script.
