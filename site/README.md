# facetshot's site

The documentation site at https://sung-eon.github.io/facetshot/, made with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build). Its pages are the repository's `docs/` and the README's opening:
`scripts/sync-docs.ts` turns them into Starlight content before every build, so there is no second copy to keep up
to date. Edit `docs/` and `README.md`, not the generated files.

```sh
bun install
bun run dev        # http://localhost:4321/facetshot/
bun run build      # into dist/
bun run deploy     # build, then push dist/ to the gh-pages branch (GitHub Pages serves it)
```

- The sidebar follows the sections of `docs/README.md`. A new page appears once it is listed there.
- Each page's title is its first `# Heading`, and its description its first paragraph.
- Links between docs become site routes; links to other files in the repository become links to them on GitHub.
- The look (colours, type) is in `src/styles/custom.css`.

Deploying needs push access to the repository and GitHub Pages set to serve the `gh-pages` branch. There is no CI;
deploy from a clone when the docs change.
