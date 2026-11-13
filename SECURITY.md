# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

1. Open the repository on GitHub and go to its **Security** tab.
2. Choose **Report a vulnerability**, and describe the problem, how to reproduce it, and what an attacker could do
   with it.

The report is visible only to the maintainers until a fix is published. You'll get an answer in the report's thread.

## What is in scope

- facetshot's own code: the command line, the MCP server, the background helper and its socket, the drivers, and the
  Agent Skill in `skills/`.
- What facetshot writes to disk, and what it masks in logs and sends to an agent's model.
- The Mac window helper and the iOS test runner that ship with the package.

Bugs in Playwright, Bun, Xcode or an MCP client belong to those projects. Your own app's code, which facetshot runs on
purpose (see the trust model in [Security](docs/security.md#trust-model)), is also out of scope.

## Hardening

- Give each agent or sandbox its own `FACETSHOT_HOME`, so it talks to a background helper of its own and doesn't see
  the sessions other agents opened through the shared one.
- Use `--no-daemon` (or `FACETSHOT_NO_DAEMON=1`) where nothing should keep running after a command, such as in CI.
- Run `facetshot clean` after runs that used real credentials: it deletes saved sign-ins, steps given inline (with
  what was typed) and run logs.
- Don't point steps or personas at production accounts. Use test accounts, never a real person's.

[Security](docs/security.md) describes what an agent can do through facetshot, what is stored on disk and what is
masked.
