import { getJson, TTL } from '../net/http'

const WIKI_API = 'https://en.wikipedia.org/w/api.php'

export interface WikipediaSummary {
  title: string
  url: string
  extract: string
  /** File name (no "File:" prefix) of the article's lead image on Commons, if any. */
  pageImageFile: string | null
}

/**
 * Intro text + lead-image file name for a species' English Wikipedia article.
 * The image itself is NOT used directly: the lead image is often a range map,
 * a drawing or a fossil, and carries no attribution here. speciesImage.ts
 * looks the file up on Commons (license, author, categories) and only uses it
 * as a labeled last resort. Cached a week. Returns null when there's no
 * article; THROWS on network failure so callers can tell the two apart.
 */
export async function searchWikipedia(scientificName: string): Promise<WikipediaSummary | null> {
  const data = await getJson<any>(WIKI_API, {
    params: {
      action: 'query',
      titles: scientificName,
      format: 'json',
      prop: 'extracts|pageimages|info',
      exintro: true,
      explaintext: true,
      piprop: 'name',
      inprop: 'url',
      redirects: 1
    },
    ttlMs: TTL.WEEK,
    timeoutMs: 8000,
    // MediaWiki reports errors with HTTP 200 + { error: ... }; don't cache those.
    validate: (d: any) => !!d && typeof d === 'object' && !d.error
  })

  const pages = data?.query?.pages
  if (!pages) return null
  const page = Object.values(pages)[0] as any
  if (!page || page.missing !== undefined || page.invalid !== undefined) return null

  return {
    title: page.title,
    url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    extract: typeof page.extract === 'string' ? page.extract.replace(/<[^>]*>/g, '').trim() : '',
    pageImageFile: typeof page.pageimage === 'string' ? page.pageimage : null
  }
}
