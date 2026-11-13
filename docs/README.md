# facetshot documentation

If you are new to facetshot, read [Getting started](getting-started.md) first, then [How it works](concepts.md). The
rest can be read in any order, when you need it.

Most pages write commands as `facetshot …`. Without installing it, or with facetshot installed in your project, type
`bunx facetshot …`.

## Everyday

- [Getting started](getting-started.md): install, your first screenshots, your first config, updating and removing
- [Web apps](web.md): building and serving your app, live sites, readiness, stable screenshots, other browsers
- [Sign-in, servers and test data](auth-and-data.md): logging in as a test user (a persona), your API and other
  services, test data
- [Flows](flows.md): saved lists of steps (clicks, typing) for screenshots of menus, dialogs and half-filled forms,
  batches to run again, and every step
- [Sessions](sessions.md): keeping one screen open to use it step by step, from the command line or an agent
- [Comparing](comparing.md): what changed since the last run or a saved baseline
- [AI agents](agents.md): connecting Claude Code, Cursor or Codex, and a workflow that suits them
- [Continuous integration](ci.md): running facetshot in CI and keeping its output

## Other platforms

- [iOS simulators](ios.md): iPhone and iPad screens of your app, opened by deep link
- [SwiftUI scenes](swiftui.md): SwiftUI views drawn inside a test, without launching the app
- [Desktop apps](desktop.md): Electron, Tauri and native Mac apps, and the Mac permissions they need
- [Flutter](flutter.md): Flutter apps on the web, macOS and iOS
- [Storybook](storybook.md): every story on every device, from a running or built Storybook

## Reference

- [Command reference](cli.md): commands, options, exit codes and environment variables
- [Configuration reference](configuration.md): every key in `facetshot.config.ts`
- [MCP tools](mcp.md): every tool and parameter the MCP server offers
- [Checks](checks.md): what facetshot reads on each screen
- [Logs](logs.md): what is recorded, and how to read it again

## Explanation

- [How it works](concepts.md): targets (what to look at), devices, variants (display settings such as dark mode),
  profiles (named sets of devices and variants), runs, and a glossary
- [Architecture](architecture.md): how the code is laid out, the background helper (the process that keeps browsers
  and servers running between runs), and how work shares the machine
- [Speed and machine safety](performance.md): what makes runs fast
- [How facetshot compares](comparison.md): Playwright, visual regression services and Playwright MCP, and when to use
  each
- [Security](security.md): what an agent can do, what is stored on disk, and what is masked; reporting a
  vulnerability is in [SECURITY.md](../SECURITY.md)

## Help

- [Troubleshooting](troubleshooting.md): screenshots of spinners or sign-in pages, permissions, stuck runs,
  removing facetshot
- [Status and limits](status.md): what is tested on which system, and what isn't supported yet
