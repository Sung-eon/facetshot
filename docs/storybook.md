# Storybook

If your components have [Storybook](https://storybook.js.org) stories, facetshot can take every story on every
device and variant without any extra setup per story. Storybook 7 to 10 are supported.

## Setup

Tell facetshot where your Storybook is — one you run yourself, or a static build it makes and serves:

```ts
storybook: { url: 'http://localhost:6006' }
```

```ts
storybook: {
	build: {
		cmd: 'npx storybook build -o storybook-static',
		inputs: ['src', '.storybook', 'package.json'],
		output: 'storybook-static'
	}
}
```

As with web builds, the static build only runs again when one of its inputs has changed.

## Choosing stories

```sh
facetshot story:button--primary          # one story, by id
facetshot story:Button                   # every story of a component
facetshot story:Forms                    # every story in a folder of components
facetshot 'story:Button/*'               # a glob over titles and names
facetshot 'story:*' --on phone,desktop   # everything
```

Matching ignores case. Each story becomes its own screen in the results (`Button.Primary`), with a contact sheet of
its own.

Docs pages are left out, and so are stories you've opted out of tests: tagged `!test` (Storybook 8.1+) or
`facetshot-skip`. A story you name exactly is always taken, whatever its tags.

## When a story counts as ready

facetshot waits for Storybook to finish preparing, loading, rendering and running the story's `play` function, and
for the story to have drawn something, and then applies the usual [readiness rules](web.md#when-a-page-counts-as-ready).
Rules for stories go under `storybook.ready`; keys under `routes` match story ids:

```ts
storybook: {
	ready: { gone: ['.loading'], routes: { 'chart--*': { timeout: 30000 } } }
}
```

A story can carry its own settings in its parameters:

```ts
export const Live: Story = {
	parameters: { facetshot: { skip: true } }               // never pictured
};
export const Chart: Story = {
	parameters: { facetshot: { ready: { visible: ['svg'] }, mask: ['.timestamp'] } }
};
```

If Storybook shows an error for a story, it's reported as a finding on that picture.

## Themes and other variants

Light and dark, contrast, reduced motion and print come from the browser, as on any web page. If your Storybook
switches themes with a toolbar global instead of following the browser, map variants to globals:

```ts
storybook: {
	globals: { light: 'theme:light', dark: 'theme:dark', locale: 'locale:{locale}' }
}
```

Keys are variant names (or `locale`, for any variant with a locale); values are `key:value` pairs, joined with `;`.
