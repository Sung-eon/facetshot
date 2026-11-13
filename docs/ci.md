# Continuous integration

facetshot is made for looking at screens while you work, but it also runs in CI, for example to attach screenshots
to every pull request. Web pages should work on Linux runners (not yet tried; see [Status](status.md)). iOS and
SwiftUI targets need a macOS runner with Xcode. Mac window screenshots need the Screen Recording permission, and steps
in them need Accessibility, which hosted runners usually can't grant.

## A job, step by step

1. Install Bun 1.3 or newer and your project's dependencies, including facetshot.
2. Install the browser with the system libraries it needs:

   ```sh
   bunx playwright install --with-deps chromium
   ```

3. Run facetshot without the background helper, since nothing should stay running after the job:

   ```sh
   bunx facetshot / /settings /billing --no-daemon --format md > screenshots.md
   ```

   `FACETSHOT_NO_DAEMON=1` does the same as `--no-daemon` for every command.

4. Upload the run folder as a build artifact, so the screenshots and `report.html` can be downloaded:
   `.facetshot/runs/*` (or the folder you gave with `--out`).

## A summary for the pull request

`--format md` prints a Markdown summary with each sheet as an image. Its image links are file paths on the runner, so
posted as they are, a comment shows broken images. Upload the sheets somewhere the comment can reach (the artifact
from step 4, or any image host), and rewrite the links to point there before you post it.

## Failing a job

The exit codes are in the [command reference](cli.md#exit-codes). Findings from [checks](checks.md) and changes found
by comparing don't change the exit code. To fail a job on them, read `manifest.json` (described by
[`schema/manifest.v1.json`](../schema/manifest.v1.json)). For example, to fail when any check found an error:

```sh
bunx facetshot check / /settings --no-daemon --json > manifest.json
jq -e '[.cells[].findings[]? | select(.severity == "error")] | length == 0' manifest.json
```

## Baselines

To compare a pull request with the main branch, the job needs a baseline. Either commit baselines to the repository
(`.facetshot/baselines/<name>`, saved with `facetshot baseline save <name>`; ignore `.facetshot/*` and add
`!.facetshot/baselines/` to `.gitignore`), or make one in the same job: check out
the main branch, take the screenshots, save them with `facetshot baseline save main`, check out the pull request, and
run again with `--diff=main`.

Screenshots taken on a CI runner can differ from those taken on your own machine (fonts, pixel density), so compare
screenshots taken on the same kind of runner. See [Comparing](comparing.md).
