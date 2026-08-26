# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.astro`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so the deployed head is the only place a broken one shows up.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.

- `scrollIntoView` isn't implemented in jsdom. Any DOM-wiring code that calls it
  must feature-detect first (`typeof el.scrollIntoView === "function"`), or the
  jsdom-based tests throw.
- Same story for `window.matchMedia` --- jsdom leaves it `undefined`. Feature-detect
  (`typeof view.matchMedia === "function"`) before calling it. Also: don't
  reference the bare global `window` in DOM-wiring code tested via `new
  JSDOM(...)` outside a jsdom test environment (these `spec/*-dom.test.ts`
  files run under vitest's `node` environment) --- derive it from the element
  instead (`el.ownerDocument.defaultView`), or it throws `ReferenceError:
  window is not defined`.
- `[hidden]` is easy to lose to CSS. If a selector also sets `display` on the
  same element elsewhere in the stylesheet, that rule wins and the element
  stays visible even with the attribute present --- add an explicit
  `.foo[hidden] { display: none; }` override wherever both apply.
- Don't hand-place elements in a shared CSS Grid with per-item `grid-column`
  only. Auto-placement fills whatever cell comes next for anything missing an
  explicit row, which silently produces gaps in unrelated places once one
  element's height changes. Use `grid-template-areas` for any layout with more
  than two grid children.
- Asset paths (poster `src`, etc.) must be built through
  `import.meta.env.BASE_URL`-safe joins (strip the leading/trailing slash
  before concatenating), never as a root-absolute path --- root-absolute works
  on localhost and 404s under the Pages base path.
- Astro inlines a hoisted script chunk under 4096 bytes directly into the built
  HTML --- any spec test reading `doc.body.textContent` then reads source
  string literals too. Keep forbidden vocabulary out of every string literal
  regardless of how big the bundle ends up being.
- jsdom can't execute `type="module"` scripts, so a built bundle in `dist/`
  can't be driven from a parsed document. Test client behaviour by parsing the
  built HTML and mounting the **source** module (e.g. `view.ts`) against that
  document directly --- only Vite's bundling itself is then out of scope
  (covered instead by `pnpm build` succeeding).
- A DOM adapter (a `mountGame(doc, opts)`-style entry point) should take its
  `Document` as a parameter rather than reaching for a bare global, and should
  throw a named error naming any missing skeleton id it expects --- turns a
  future rename into a red test instead of a silently dead page.
