import type { CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;
export type Author = CollectionEntry<'authors'>;

/** Words-per-minute assumptions differ for Devanagari vs Latin script. */
const WPM_LATIN = 220;
const WPM_DEVANAGARI = 160;

export function estimateReadingTime(body: string, language: 'en' | 'hi'): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const wpm = language === 'hi' ? WPM_DEVANAGARI : WPM_LATIN;
  return Math.max(1, Math.round(words / wpm));
}

/** Published, non-draft articles only — the one gate for public visibility. */
export function isPublic(article: Article): boolean {
  return !article.data.draft;
}

/**
 * Sort order mirrors the Notion sync rule:
 * 1. explicit `order` first (lower = earlier), when present
 * 2. otherwise by publication date, newest first
 */
export function sortArticles(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => {
    const aHasOrder = typeof a.data.order === 'number';
    const bHasOrder = typeof b.data.order === 'number';
    if (aHasOrder && bHasOrder) return a.data.order! - b.data.order!;
    if (aHasOrder) return -1;
    if (bHasOrder) return 1;
    return b.data.publishedDate.valueOf() - a.data.publishedDate.valueOf();
  });
}

export function getPublicArticles(all: Article[]): Article[] {
  return sortArticles(all.filter(isPublic));
}

export function getFeatured(all: Article[]): Article[] {
  return getPublicArticles(all).filter((a) => a.data.featured);
}

export function formatDate(date: Date, language: 'en' | 'hi' = 'en'): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Unicode-aware slugify — keeps Devanagari (and any other script) intact
 * rather than stripping it the way a plain \w-based regex would.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function uniqueCategories(all: Article[]): string[] {
  return Array.from(new Set(getPublicArticles(all).map((a) => a.data.category))).sort();
}

export function uniqueTags(all: Article[]): string[] {
  return Array.from(new Set(getPublicArticles(all).flatMap((a) => a.data.tags))).sort();
}

export function articlesByAuthor(all: Article[], authorSlug: string): Article[] {
  return getPublicArticles(all).filter((a) => a.data.author === authorSlug);
}

export function articlesByCategory(all: Article[], category: string): Article[] {
  return getPublicArticles(all).filter(
    (a) => slugify(a.data.category) === slugify(category)
  );
}

export function articlesByTag(all: Article[], tag: string): Article[] {
  return getPublicArticles(all).filter((a) =>
    a.data.tags.some((t) => slugify(t) === slugify(tag))
  );
}
