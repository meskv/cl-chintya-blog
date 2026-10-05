import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// ---------------------------------------------------------------------------
// These two schemas are the contract between the CMS (Notion, eventually)
// and the site. Field names deliberately mirror the Notion database
// properties described in the project README / architecture notes, so a
// future `scripts/sync-notion.ts` only has to write frontmatter that matches
// this shape — nothing in src/pages or src/components needs to change.
// ---------------------------------------------------------------------------

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().transform((s) => s.trim()),
      // slug is derived from the filename by default, but Notion sync can
      // set it explicitly so URLs never depend on how a page is titled.
      description: z.string().transform((s) => s.trim()),
      coverImage: image().optional(),
      coverImageAlt: z.string().optional(),
      author: z.string(), // references an authors/*.md slug
      publishedDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.string(),
      tags: z.array(z.string()).default([]),
      language: z.enum(['en', 'hi']).default('en'),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
      order: z.number().optional(),
      // Reading time is computed at build time (see src/lib/reading-time.ts)
      // but can be overridden here if Notion ever supplies its own estimate.
      readingTimeOverride: z.number().optional(),
    }),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/authors' }),
  schema: ({ image }) =>
    z.object({
      name: z.string().transform((s) => s.trim()),
      bio: z.string().transform((s) => s.trim()),
      photo: image().optional(),
      website: z.string().url().optional(),
      social: z
        .object({
          twitter: z.string().url().optional(),
          linkedin: z.string().url().optional(),
          instagram: z.string().url().optional(),
        })
        .optional(),
      active: z.boolean().default(true),
    }),
});

export const collections = { articles, authors };
