# Chintya

चिंत्य — CHINTYA

Things worth thinking about.

Chintya is an editorial publication about ideas that don't fit into one
subject: philosophy, economics, technology, culture, and the ordinary
questions underneath all of them. This repository is the static site that
powers it.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:4321. The site is fully working right now with
sample content — nothing here is a mockup.

```bash
npm run build     # builds to ./dist
npm run preview   # serves the production build locally
```

## What's in here

- **Astro** (static output) + **TypeScript**
- Content collections for `articles` and `authors` — see
  `src/content.config.ts`. This schema is the contract the future Notion
  sync must satisfy; nothing in `src/pages` or `src/components` needs to
  change once real content replaces the samples.
- Sample content lives in `src/content/articles/*.md` and
  `src/content/authors/*.md` — 10 published essays (2 in Hindi), 1 draft
  (to prove drafts never reach the live site), 4 authors, 5 categories.
- Client-side search: `src/pages/search-index.json.ts` builds a small JSON
  index at build time; `src/pages/search.astro` filters it in the browser.
  No server, no third-party search service.
- RSS at `/rss.xml`, sitemap at `/sitemap-index.xml` (via
  `@astrojs/sitemap`), full SEO + Open Graph metadata per page.
- Light/dark theme, persisted per-visitor via `localStorage`, with a
  no-flash boot script in `<head>`. Both themes are deliberately designed,
  not a simple color inversion.
- Typography: Noto Serif for English long-form text, Noto Serif Devanagari
  for Hindi long-form text and the logo's Hindi mark, Inter for UI chrome.
  These two serif families are designed together for cross-script harmony.

## Content model

Every article needs, at minimum:

```yaml
title: ...
description: ...
author: some-author-slug        # must match a file in src/content/authors/
publishedDate: 2026-01-01
category: Economics
language: en                     # or "hi"
```

Optional fields: `coverImage`, `coverImageAlt`, `updatedDate`, `tags`
(array), `featured` (boolean), `order` (number — lower sorts earlier;
articles without `order` fall back to `publishedDate`, newest first),
`draft` (boolean — draft articles are excluded from every listing, the
RSS feed, the sitemap, and search).

Authors need `name`, `bio`, and `active: true`. Optional: `photo`,
`website`, `social.{twitter,linkedin,instagram}`.

To add a new article by hand right now: drop a new `.md` file into
`src/content/articles/`, and a new author into `src/content/authors/` if
needed. That's the entire workflow until the Notion pipeline below is
switched on.

## The Notion pipeline

```
Notion (Articles + Authors databases)
  → GitHub Action (on push, on manual run, and every 15 minutes)
  → scripts/sync-notion.ts converts Notion pages to Markdown
  → written into src/content/articles/ and src/content/authors/
  → Astro build
  → GitHub Pages
```

This is fully implemented, not a stub. `scripts/sync-notion.ts`:

- Queries both databases via the Notion API (using the current
  `data_source`-based endpoints Notion moved to in late 2025).
- Writes one `.md` file per row into `src/content/articles/` and
  `src/content/authors/`, in the exact frontmatter shape
  `src/content.config.ts` expects.
- Only articles with **Status = Published** are written; everything else
  is skipped.
- Downloads the Cover Image / Photo files locally (Notion's own file
  URLs expire after about an hour, so the site never depends on them),
  and downloads any image embedded directly in an article's body too.
- Keeps itself in sync automatically. Every file it writes carries a
  hidden `notionId` field. On each run, any previously-written file whose
  `notionId` is no longer in the fresh fetch gets deleted. That one rule
  covers every case you care about:
  - add a new article -> it appears next sync
  - flip Status from Draft to Published -> it appears next sync
  - flip Status from Published to Draft -> it disappears next sync
  - delete a page in Notion -> its file disappears next sync
  - edit any field -> the file is rewritten
  - add or edit an author -> same behavior
- Never touches files that don't have a `notionId` — so the hand-written
  sample content in this repo is left alone. Delete the sample `.md`
  files yourself once you have real content in Notion, whenever you're
  ready; nothing forces you to do it on a schedule.

**The Notion token never reaches the browser.** It's read only inside the
GitHub Actions runner, from a repository secret, during the sync step.

**Note:** the Actions workflow syncs and builds inside the CI runner —
it does not commit the generated `.md`/image files back into this
repository. Notion stays the single source of truth; git only ever
holds the sample content plus the code. If you want a git history of
every article too, that's a reasonable thing to add later (a commit
step in the workflow), but it isn't necessary for the site to work.

### Setting it up

1. **Create the two Notion databases** with these exact property names:

   **Articles**: `Title` (Title), `Slug` (Text), `Status` (Select:
   `Draft`/`Published`), `Author` (Relation -> Authors database, single),
   `Published Date` (Date), `Updated Date` (Date), `Category` (Select),
   `Tags` (Multi-select), `Language` (Select: `English`/`Hindi`),
   `Featured` (Checkbox), `Order` (Number), `Description` (Text),
   `Cover Image` (Files & media). The page body is the article content.

   **Authors**: `Name` (Title), `Slug` (Text), `Bio` (Text), `Photo`
   (Files & media), `Website` (URL), `Twitter` (URL), `LinkedIn` (URL),
   `Instagram` (URL), `Active` (Checkbox).

   `Slug` on both is what becomes the URL and filename — use
   lowercase-with-hyphens.

2. **Create a Notion integration** at
   notion.so/my-integrations, internal, read-only content capability.
   Copy the integration token.

3. **Connect the integration to both databases** — open each database in
   Notion, `...` menu -> Connections -> add your integration. This step
   is easy to miss and causes an "object not found" error if skipped.

4. **Get each database ID** from its Notion URL: the 32-character string
   right after your workspace name, before the `?`.

5. **Add three repository secrets** on GitHub: Settings -> Secrets and
   variables -> Actions -> New repository secret:
   - `NOTION_TOKEN`
   - `NOTION_ARTICLES_DB_ID`
   - `NOTION_AUTHORS_DB_ID`

6. That's it. The next scheduled run (within 15 minutes), or a manual run
   from the Actions tab (Deploy Chintya to GitHub Pages -> Run workflow),
   will pull your Notion content in.

### Testing it locally before relying on GitHub Actions

```bash
cp .env.example .env
# fill in your real token and database IDs in .env
npm run sync:notion
npm run dev
```

Check `src/content/articles/` and `src/content/authors/` for the new
`.md` files, and check the dev server shows them.

### Wanting updates faster than 15 minutes

Notion doesn't offer webhooks for plain database edits (only for
Notion's own paid Automations in some plans), so the reliable free
option is polling — which is what the 15-minute schedule does. For
something closer to instant after you press Publish in Notion, the
simplest option is the **Run workflow** button on the Actions tab: it
finishes a sync and deploy in about the same time as any other push.

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on
every push to `main`, on manual dispatch, and every 15 minutes (so new
Notion content shows up even with no code changes). It runs
`npm run sync:notion` before the build, using the three secrets above.

Repository: `meskv/chintya-blog-c` (or whatever you named it) ->
published at `blog.chintya.com`, or at
`https://<your-username>.github.io/<repo-name>/` if you haven't set up
the custom domain yet (in which case remove `public/CNAME` and set
`base` in `astro.config.mjs` accordingly).

No paid server, no database, no runtime backend.

## Known follow-ups worth doing before a public launch

- Replace the sample authors' `website`/`social` URLs — they currently
  point at `example.com` placeholders.
- Swap the abstract SVG cover art for real commissioned or licensed
  images once available; the `coverImage` field accepts any raster or
  vector image.
- The default Open Graph image (`public/og-default.svg`) is an SVG;
  some social platforms render OG images more reliably as PNG/JPEG, so
  consider exporting a rasterized version before relying on link
  previews heavily.
- Once real Notion content exists, delete the sample `.md` files in
  `src/content/articles/` and `src/content/authors/` (they have no
  `notionId`, so the sync script will never remove them for you).
