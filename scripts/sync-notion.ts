/**
 * scripts/sync-notion.ts
 * ---------------------------------------------------------------------------
 * Pulls the Articles and Authors databases from Notion and writes them as
 * Markdown files into src/content/articles/ and src/content/authors/,
 * matching the schema in src/content.config.ts exactly.
 *
 * Runs ONLY in GitHub Actions (or locally via `npm run sync:notion` with a
 * .env file) — never in the browser. The Notion token never reaches any
 * client-side asset.
 *
 * How "keeps itself up to date" works:
 *   - Every article/author written by this script carries a hidden
 *     `notionId:` frontmatter field.
 *   - On every run, any existing file that carries a `notionId` NOT present
 *     in this run's fresh fetch gets deleted. That one rule handles every
 *     case you asked about:
 *       - new article added in Notion            -> new file appears
 *       - Status changed Draft -> Published       -> file appears
 *       - Status changed Published -> Draft        -> file is removed
 *       - a Notion page is deleted/archived        -> file is removed
 *       - any field is edited                      -> file is rewritten
 *   - Files WITHOUT a `notionId` (hand-written sample content, or anything
 *     you wrote directly in the repo) are never touched by this script.
 *
 * Required environment variables (GitHub Actions secrets, or a local .env):
 *   NOTION_TOKEN            — internal integration token, read-only content
 *   NOTION_ARTICLES_DB_ID   — the Articles database ID
 *   NOTION_AUTHORS_DB_ID    — the Authors database ID
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { Client, isFullPage } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const ARTICLES_COVERS_DIR = path.join(ARTICLES_DIR, 'covers');
const AUTHORS_DIR = path.join(process.cwd(), 'src/content/authors');
const AUTHORS_PHOTOS_DIR = path.join(AUTHORS_DIR, 'photos');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ARTICLES_DB_ID = process.env.NOTION_ARTICLES_DB_ID;
const AUTHORS_DB_ID = process.env.NOTION_AUTHORS_DB_ID;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sanitizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/?%*:|"<>]/g, '');
}

function getPlainText(richText: any[] | undefined): string {
  if (!richText || richText.length === 0) return '';
  return richText.map((t) => t.plain_text ?? '').join('');
}

function getProp(page: any, name: string): any {
  return page.properties?.[name];
}

function getTitle(page: any, name: string): string {
  return getPlainText(getProp(page, name)?.title);
}

function getText(page: any, name: string): string {
  return getPlainText(getProp(page, name)?.rich_text);
}

function getSelect(page: any, name: string): string | null {
  return getProp(page, name)?.select?.name ?? null;
}

function getMultiSelect(page: any, name: string): string[] {
  return (getProp(page, name)?.multi_select ?? []).map((o: any) => o.name);
}

function getCheckbox(page: any, name: string): boolean {
  return Boolean(getProp(page, name)?.checkbox);
}

function getNumber(page: any, name: string): number | undefined {
  const n = getProp(page, name)?.number;
  return typeof n === 'number' ? n : undefined;
}

function getDate(page: any, name: string): string | undefined {
  return getProp(page, name)?.date?.start ?? undefined;
}

function getUrl(page: any, name: string): string | undefined {
  return getProp(page, name)?.url ?? undefined;
}

function getRelationIds(page: any, name: string): string[] {
  return (getProp(page, name)?.relation ?? []).map((r: any) => r.id);
}

function getFileUrl(page: any, name: string): string | undefined {
  const files = getProp(page, name)?.files ?? [];
  const first = files[0];
  if (!first) return undefined;
  return first.type === 'external' ? first.external?.url : first.file?.url;
}

function guessExtension(url: string, fallback = 'jpg'): string {
  const clean = url.split('?')[0];
  const ext = path.extname(clean).replace('.', '');
  return ext && ext.length <= 5 ? ext : fallback;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buffer);
}

/** Removes any managed (notionId-tagged) file whose id isn't in `keepIds`. */
async function cleanupStale(dir: string, keepIds: Set<string>): Promise<number> {
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(dir, entry);
    const raw = await fs.readFile(filePath, 'utf-8');
    const { data } = matter(raw);
    if (data.notionId && !keepIds.has(data.notionId)) {
      await fs.rm(filePath);
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!NOTION_TOKEN || !ARTICLES_DB_ID || !AUTHORS_DB_ID) {
    console.log(
      '[sync-notion] Notion credentials are not configured — skipping sync ' +
        'and leaving src/content/ untouched. Set NOTION_TOKEN, ' +
        'NOTION_ARTICLES_DB_ID and NOTION_AUTHORS_DB_ID to enable this step.'
    );
    return;
  }

  const notion = new Client({ auth: NOTION_TOKEN });
  const n2m = new NotionToMarkdown({ notionClient: notion });

  // Custom image transformer: Notion-hosted file URLs expire after ~1 hour,
  // so any image embedded in an article body is downloaded and rewritten to
  // a local, permanent path instead of being left as a Notion URL.
  n2m.setCustomTransformer('image', async (block: any) => {
    try {
      const image = block.image;
      const url = image?.type === 'external' ? image.external?.url : image?.file?.url;
      if (!url) return false;
      const caption = getPlainText(image.caption) || '';
      const ext = guessExtension(url, 'jpg');
      const filename = `inline-${block.id}.${ext}`;
      await downloadFile(url, path.join(ARTICLES_COVERS_DIR, filename));
      const alt = caption.replace(/[[\]]/g, '');
      const md = `![${alt}](./covers/${filename})${caption ? `\n*${caption}*` : ''}`;
      return md;
    } catch (err) {
      console.warn('[sync-notion] Failed to download inline image, leaving default:', err);
      return false; // fall back to notion-to-md's default handling
    }
  });

  async function queryDataSource(databaseId: string) {
    const db = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = (db as any).data_sources?.[0]?.id;
    if (!dataSourceId) {
      throw new Error(
        `Could not find a data source for database ${databaseId}. ` +
          `Make sure the integration is connected to this database.`
      );
    }

    const pages: any[] = [];
    let cursor: string | undefined;
    do {
      const response: any = await notion.dataSources.query({
        data_source_id: dataSourceId,
        start_cursor: cursor,
        page_size: 100,
      });
      pages.push(...response.results.filter(isFullPage));
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return pages;
  }

  // -------------------------------------------------------------------
  // Authors
  // -------------------------------------------------------------------
  console.log('[sync-notion] Fetching authors...');
  const authorPages = await queryDataSource(AUTHORS_DB_ID);
  const authorSlugById = new Map<string, string>();
  const authorKeepIds = new Set<string>();

  for (const page of authorPages) {
    const notionId = page.id;
    const name = getTitle(page, 'Name');
    const rawSlug = getText(page, 'Slug') || sanitizeSlug(name);
    const slug = sanitizeSlug(rawSlug);
    if (!slug) {
      console.warn(`[sync-notion] Skipping author "${name}" — no usable slug.`);
      continue;
    }
    authorSlugById.set(notionId, slug);
    authorKeepIds.add(notionId);

    const bio = getText(page, 'Bio');
    const website = getUrl(page, 'Website');
    const twitter = getUrl(page, 'Twitter');
    const linkedin = getUrl(page, 'LinkedIn');
    const instagram = getUrl(page, 'Instagram');
    const active = getCheckbox(page, 'Active');

    let photoField: string | undefined;
    const photoUrl = getFileUrl(page, 'Photo');
    if (photoUrl) {
      const ext = guessExtension(photoUrl, 'jpg');
      const filename = `${slug}.${ext}`;
      await downloadFile(photoUrl, path.join(AUTHORS_PHOTOS_DIR, filename));
      photoField = `./photos/${filename}`;
    }

    const frontmatter: Record<string, unknown> = {
      notionId,
      name,
      bio,
      active,
    };
    if (website) frontmatter.website = website;
    if (twitter || linkedin || instagram) {
      frontmatter.social = {
        ...(twitter ? { twitter } : {}),
        ...(linkedin ? { linkedin } : {}),
        ...(instagram ? { instagram } : {}),
      };
    }
    if (photoField) frontmatter.photo = photoField;

    const fileContents = matter.stringify('', frontmatter);
    await fs.mkdir(AUTHORS_DIR, { recursive: true });
    await fs.writeFile(path.join(AUTHORS_DIR, `${slug}.md`), fileContents, 'utf-8');
  }

  const authorsRemoved = await cleanupStale(AUTHORS_DIR, authorKeepIds);
  console.log(
    `[sync-notion] Authors: wrote ${authorKeepIds.size}, removed ${authorsRemoved} stale file(s).`
  );

  // -------------------------------------------------------------------
  // Articles
  // -------------------------------------------------------------------
  console.log('[sync-notion] Fetching articles...');
  const articlePages = await queryDataSource(ARTICLES_DB_ID);
  const articleKeepIds = new Set<string>();
  let published = 0;
  let skippedDraft = 0;

  for (const page of articlePages) {
    const notionId = page.id;
    const title = getTitle(page, 'Title');
    const status = getSelect(page, 'Status');

    if (status !== 'Published') {
      skippedDraft++;
      continue; // not kept in articleKeepIds -> cleanup will remove any existing file
    }

    const rawSlug = getText(page, 'Slug') || sanitizeSlug(title);
    const slug = sanitizeSlug(rawSlug);
    if (!slug) {
      console.warn(`[sync-notion] Skipping article "${title}" — no usable slug.`);
      continue;
    }

    const authorRelationIds = getRelationIds(page, 'Author');
    const authorSlug = authorRelationIds.map((id) => authorSlugById.get(id)).find(Boolean);
    if (!authorSlug) {
      console.warn(
        `[sync-notion] Skipping "${title}" — its Author relation doesn't resolve to a ` +
          `synced author (is the author's Slug property set?).`
      );
      continue;
    }

    const description = getText(page, 'Description');
    const category = getSelect(page, 'Category') ?? 'Uncategorised';
    const tags = getMultiSelect(page, 'Tags');
    const languageRaw = (getSelect(page, 'Language') ?? 'English').toLowerCase();
    const language = languageRaw.startsWith('hi') ? 'hi' : 'en';
    const featured = getCheckbox(page, 'Featured');
    const order = getNumber(page, 'Order');
    const publishedDate = getDate(page, 'Published Date') ?? page.created_time;
    const updatedDate = getDate(page, 'Updated Date');

    let coverImageField: string | undefined;
    const coverUrl = getFileUrl(page, 'Cover Image');
    if (coverUrl) {
      const ext = guessExtension(coverUrl, 'jpg');
      const filename = `${slug}.${ext}`;
      await downloadFile(coverUrl, path.join(ARTICLES_COVERS_DIR, filename));
      coverImageField = `./covers/${filename}`;
    }

    const mdBlocks = await n2m.pageToMarkdown(notionId);
    const { parent: body } = n2m.toMarkdownString(mdBlocks);

    const frontmatter: Record<string, unknown> = {
      notionId,
      title,
      description,
      author: authorSlug,
      publishedDate,
      category,
      tags,
      language,
      featured,
      draft: false,
    };
    if (updatedDate) frontmatter.updatedDate = updatedDate;
    if (typeof order === 'number') frontmatter.order = order;
    if (coverImageField) frontmatter.coverImage = coverImageField;

    const fileContents = matter.stringify(body ?? '', frontmatter);
    await fs.mkdir(ARTICLES_DIR, { recursive: true });
    await fs.writeFile(path.join(ARTICLES_DIR, `${slug}.md`), fileContents, 'utf-8');

    articleKeepIds.add(notionId);
    published++;
  }

  const articlesRemoved = await cleanupStale(ARTICLES_DIR, articleKeepIds);
  console.log(
    `[sync-notion] Articles: wrote ${published} published, skipped ${skippedDraft} ` +
      `non-published, removed ${articlesRemoved} stale file(s).`
  );
}

main().catch((err) => {
  console.error('[sync-notion] Failed:', err);
  process.exit(1);
});
