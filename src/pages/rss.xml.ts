import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { getPublicArticles } from '../lib/utils';

export async function GET(context: APIContext) {
  const all = await getCollection('articles');
  const articles = getPublicArticles(all);

  return rss({
    title: 'Chintya',
    description: 'Things worth thinking about — essays on philosophy, economics, technology, culture and society.',
    site: context.site ?? 'https://blog.chintya.com',
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.publishedDate,
      link: `/blog/${article.id}/`,
      categories: [article.data.category, ...article.data.tags],
    })),
    customData: `<language>en-in</language>`,
  });
}
