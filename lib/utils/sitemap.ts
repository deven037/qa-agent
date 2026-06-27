export async function fetchSitemap(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')

  async function fetchXml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  function parseLocTags(xml: string): string[] {
    const paths: string[] = []
    const re = /<loc>(.*?)<\/loc>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
      const raw = m[1].trim()
      // Convert absolute URL to relative path
      const path = raw.startsWith(base) ? raw.slice(base.length) || '/' : raw.startsWith('http') ? null : raw
      if (!path) continue
      // Skip non-page extensions
      if (/\.(xml|pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|txt|json)(\?|$)/i.test(path)) continue
      paths.push(path || '/')
    }
    return paths
  }

  // Try sitemap.xml
  let xml = await fetchXml(`${base}/sitemap.xml`)

  // Sitemap index — fetch first child
  if (xml?.includes('<sitemapindex')) {
    const childMatch = /<loc>(.*?)<\/loc>/i.exec(xml)
    if (childMatch) {
      const childXml = await fetchXml(childMatch[1].trim())
      if (childXml) xml = childXml
    }
  }

  if (!xml) {
    xml = await fetchXml(`${base}/sitemap_index.xml`)
  }

  // robots.txt fallback
  if (!xml) {
    const robots = await fetchXml(`${base}/robots.txt`)
    if (robots) {
      const sitemapMatch = /^Sitemap:\s*(.+)$/im.exec(robots)
      if (sitemapMatch) xml = await fetchXml(sitemapMatch[1].trim())
    }
  }

  if (!xml) return []

  const paths = parseLocTags(xml)
  // Deduplicate and cap at 200
  return [...new Set(paths)].slice(0, 200)
}
