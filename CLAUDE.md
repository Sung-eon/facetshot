# Working on facetshot

facetshot takes screenshots of an app's screens on several devices and display settings at once, lists what looks
broken, keeps what the app logged, and lets an agent use a screen step by step. It is an open-source package (MIT)
used by people and AI coding agents, through a command line, an MCP server and an Agent Skill. `AGENTS.md` is a link
to this file, so Codex and Claude Code read the same instructions.

Start with [docs/architecture.md](docs/architecture.md) for the module map, the life of a run and how to add a
driver. This file holds what every session working on the repository must keep in mind.

## Ground rules

- **Bun only.** Run everything with Bun (`bun --bun …`, `bunx`); never npm, node or yarn for running or installing.
  facetshot itself requires Bun 1.3+, whatever the user's app is built with.
- **Generic, never personal.** Code, docs, examples and tests contain nothing about one person, company or project:
  no product names, people's names, emails, machine paths (`/Users/…`) or private URLs. Examples are made-up apps.
- **Docs are for the people using facetshot.** Write README and docs for a first-time reader, in plain, native
  English. They are never a maker's log: no "we tried", "at first", dates of work or the author's own story.
- **Be humble about other tools.** facetshot is built on Playwright and sits beside Playwright MCP and the visual
  regression services. Describe what each does well and the smaller job facetshot covers; never run them down.
- **Honest limits, in one place.** [docs/status.md](docs/status.md) is the single list of what has been tested, what
  is written but not yet run (and where), and what is planned. Anything new that hasn't been run end to end goes
  there first; other pages hedge and link to it. Never describe something as working that nobody has seen work.
- **One fact, one place.** Each fact (a limit, a default, a table of options) lives on one page; others link to it.
  Repetition drifts and reads as filler.
- **No compatibility shims before 1.0.** When a name or option changes, change every caller, doc and test in the same
  commit; don't leave aliases or deprecation paths behind.
- **Fix structurally.** A security or correctness bug gets one enforcement point and a test that guards it, not a
  patch at each call site.

## Building and checking

```sh
bun install
bun --bun tsc --noEmit -p .     # types
bun test test                   # unit and end-to-end tests
bun run lint                    # Prettier (bun run format fixes it)
```

All three must pass before a commit. Some tests skip when the machine lacks something, and say so in their names:

- Electron and Tauri tests need the examples' dependencies (`bun install` in `examples/electron`, `examples/tauri`).
- Mac window tests need **Screen Recording**, and steps and sessions need **Accessibility**, granted to the app the
  tests run in (System Settings → Privacy & Security). `facetshot doctor` shows both.
- There is no automated iOS simulator test yet; iOS changes are checked by hand and recorded in `docs/status.md`.

Taking care of the machine:

- **Use your own background helper when testing.** facetshot's helper is shared by every project and agent of the
  user and restarts when facetshot's code changes. Run tests and manual checks with
  `FACETSHOT_HOME=<a scratch folder>` so you neither restart nor wait for the helper other sessions are using.
- **Check the load before heavy work.** Look at `uptime` before Xcode builds, simulators, Rust builds or many
  browsers. Above roughly 3× the core count, wait; run long builds with `nice`. Overloading the machine has crashed it
  before.
- **Don't install system tools silently.** Toolchains (Rust, Flutter, Xcode components) are installed only when the
  person asks or agrees, and never by deleting or replacing what they have.

## Documentation and the website

`docs/` is the only source of documentation. The GitHub Pages site in `site/` renders `docs/*.md` at build time; it
never holds a copy of the text. GitHub also shows `docs/` directly, so every page must read well in both places.

When you change behaviour, update the docs in the same commit:

1. Change the page that owns the fact (see `docs/README.md` for which page covers what), and `docs/status.md` if
   what's tested changed.
2. A new page: create `docs/<name>.md` starting with a single `# Title` (the site uses it as the page title), add it
   to the right group in `docs/README.md` with a one-line description. The site's sidebar is generated from those
   groups (`site/scripts/sync-docs.ts`), so there is nothing else to register.
3. Link between pages with relative Markdown links (`flows.md#steps`). Link to files outside `docs/` (examples, source)
   with relative paths as well; the site turns them into GitHub links. Put images in `docs/images/` and give each one
   alt text that says what it shows.
4. Keep the README an overview: what facetshot is, why, the first run, short sections linking into `docs/`. Long
   tables and details belong in `docs/`.
5. Update the skill (below) if agents need to know about the change.
6. Run `bun run lint`, and build the site to check the page renders (`site/README.md` has the commands).

Writing style, for docs, the site and the skill:

- Plain words; short sentences; a sentence per idea. Explain a term the first time it appears, or link to the
  glossary in `docs/concepts.md`.
- No AI-sounding phrasing: no "seamless", "robust", "leverage", "delve", "powerful", slogans, or bold lead-ins that
  restate the heading. Em-dash asides are rare; prefer commas, parentheses or a new sentence.
- Say "screenshot" (not "picture" or "shot"), "background helper" (the command is `facetshot daemon`), "persona" for
  a signed-in user, "contact sheet" for the grid image.
- Show the structure the content has: tables for options and comparisons, numbered steps for procedures, code blocks
  for commands, images for anything visual.
- Use diagrams freely where a picture is quicker than prose: how the parts connect, a sequence, what turns into what
  (targets × devices × variants → a sheet), a decision. Draw them as hand-written SVG in `docs/images/` (not Mermaid,
  which GitHub and the site render differently), embedded with `![what it shows](images/name.svg)`, and keep them
  small and plain:
  - text as real `<text>` in the system font stack, at a size that stays readable when the image is shown at the
    page's width (about 760 px), and the same words the docs use;
  - readable in light and dark: a transparent background, and colours set in a `<style>` with a
    `@media (prefers-color-scheme: dark)` block (images can't see the site's own theme switch, so pick colours that
    work on both paper and the dark mat);
  - a `viewBox`, no fixed width or height, no scripts, fonts or external links;
  - a diagram supports the text next to it; it never holds the only copy of a fact.

Designing the site's pages (the site uses Sung-eon Space's visual style: warm paper, ink, a violet accent, a dark
"mat" behind images, thin display headings, mono labels):

1. Headings, body text and labels must look clearly different (size, weight, colour, typeface).
2. Sections are clearly divided: rules, spacing, background bands.
3. Use tables, diagrams, grids and images where the content calls for them, not paragraphs.
4. Few words: no filler, no repeated claims, no marketing copy.
5. No labels, eyebrows, subtitles or badges that don't tell the reader anything new.
6. A newcomer understands what facetshot is within seconds; an advanced reader reaches the MCP and configuration
   references, architecture, security, limits and the source within one or two clicks.

Check every design change with facetshot itself, at phone and desktop width in light and dark, and look at the
sheets before calling it done. A significant redesign is reviewed by three reviewers (a designer, a beginner and an
advanced user) before it is deployed.

The landing page is generated by `site/scripts/sync-docs.ts` from the README and a few docs pages; its layout lives
there and in `site/src/components/` and `site/src/styles/custom.css`. The link-preview image is `site/og/og.html`,
rendered to `site/public/og.png` with `bun run og` in `site/`; re-render it when its source changes.

Deploying the site is done by hand, from a clean main: `bun run deploy` in `site/` builds and pushes the output to
the `gh-pages` branch. If code blocks look unstyled after a theme change, delete `site/.astro` and
`site/node_modules/.astro` and build again. There is no CI; don't add workflows. Deploy only after the person has seen
the change.

## The Agent Skill

`skills/facetshot/` is what agents read in other people's projects, where `docs/` isn't available. `SKILL.md` holds
the description (when to use facetshot), the model, the workflow and the rules with their reasons; `references/`
holds the details, one topic per file, and `SKILL.md` says when to read each one. It is installed four ways, so check
all of them when its layout changes:

- copied into a project by `facetshot init --agent claude|codex` (`src/init.ts`),
- concatenated into one Cursor rule by `cursorRule()` in `src/init.ts`,
- installed with the Claude Code plugin (`.claude-plugin/`, which takes `skills/` from the repository root),
- read from `node_modules/facetshot/skills/facetshot/` by any other agent.

When an MCP tool, parameter, step or default changes, update the skill's references and the tool descriptions in
`src/integrations/mcp.ts` in the same commit; agents without the skill rely on the descriptions alone. After a
substantial change to the skill, run the agent evaluation again: give fresh agents of several model sizes one-line
tasks in the example apps with only the skill and the MCP server, and check that they look before answering, use the
cheapest tool that answers, close their sessions and never write a screenshot script.

## Releasing

- npm is the one distribution channel: `bun add -g facetshot` (standalone) and `bun add -d facetshot` (in a project)
  both install from it. There is no separate binary download.
- Versions: `package.json` and `.claude-plugin/plugin.json` carry the same version; `src/version.ts` reads
  `package.json`. Each published version has a git tag `<version>` (the bare number, such as `0.1.0`) on the commit it was published from, and a
  GitHub Release on that tag whose notes say what changed for users. The Release is the changelog; there is no
  CHANGELOG file.
- Order: bump both versions in one commit, push main, `npm publish`, then tag that commit, push the tag and create
  the Release (`gh release create <version> --notes-file …`). Never move or reuse a tag.
- Before publishing: all checks pass, `npm pack --dry-run` lists only what runs (`files` in `package.json`), the
  packed tarball installs and runs in an empty project, and `docs/status.md` is current.
- Publishing to npm, pushing, creating tags or Releases, changing the GitHub repository's settings and deploying the
  site are outward-facing: do them only when the person asks for that step.
- Commit messages say what changed and why, in plain sentences.
