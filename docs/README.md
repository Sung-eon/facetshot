# facetshot documentation

If you are new to facetshot, read [Getting started](getting-started.md) first, then [How it works](concepts.md). The
rest can be read in any order, when you need it.

## Guides

Step-by-step pages for a task.

- [Getting started](getting-started.md): install, your first screenshots, your first config
- [Web apps](web.md): building and serving your app, live sites, readiness, stable screenshots, other browsers
- [Sign-in, servers and test data](auth-and-data.md): services, personas, development-only sign-in, fixtures
- [Flows](flows.md): screenshots of menus, dialogs and half-filled forms, and the reference for every step
- [Sessions](sessions.md): using a page step by step, from the command line or an agent
- [Comparing](comparing.md): what changed since the last run or a saved baseline
- [iOS simulators](ios.md)
- [SwiftUI scenes](swiftui.md): SwiftUI views rendered inside a test, without launching the app
- [Desktop apps](desktop.md): Electron, Tauri and native Mac apps
- [Storybook](storybook.md)
- [AI agents](agents.md): connecting Claude Code, Cursor or Codex, and a workflow that suits them
- [Continuous integration](ci.md)

## Reference

- [Command reference](cli.md): commands, options, exit codes and environment variables
- [Configuration reference](configuration.md): every key in `facetshot.config.ts`
- [MCP tools](mcp.md): every tool and parameter the MCP server offers
- [Checks](checks.md): what facetshot reads on each screen
- [Logs](logs.md): what is recorded, and how to read it again

## Explanation

- [How it works](concepts.md): targets, devices, variants, profiles, runs, and a glossary
- [Architecture](architecture.md): the background helper, the runtimes, and how they share the machine
- [Speed and machine safety](performance.md): what makes runs fast, and the limits that protect the machine
- [Security](security.md): what an agent can do, what is stored on disk, and what is masked

## Help

- [Troubleshooting](troubleshooting.md)
- [Status and limits](status.md): what is tested on which system, and what isn't supported yet
