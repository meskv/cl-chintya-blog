import type { APIRoute } from 'astro';
import { getCollection, getEntry } from 'astro:content';
import { getPublicArticles, estimateReadingTime } from '../lib/utils';

export const GET: APIRoute = async () => {
  const all = await getCollection('articles');
  const published = getPublicArticles(all);

  const index = await Promise.all(
    published.map(async (article) => {
      const author = await getEntry('authors', article.data.author);
      return {
        title: article.data.title,
        description: article.data.description,
        url: `/blog/${article.id}/`,
        category: article.data.category,
        tags: article.data.tags,
        author: author?.data.name ?? article.data.author,
        language: article.data.language,
        readingTime:
          article.data.readingTimeOverride ??
          estimateReadingTime(article.body ?? '', article.data.language),
        publishedDate: article.data.publishedDate.toISOString(),
      };
    })
  );

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' },
  });
};
