// Link previews for MPS-HQ Pages (2026-11-06): Facebook, iMessage and Google
// don't run the app's code, so /p/{slug} is answered here first with the
// page's own title, description and share image in the page head, then the
// normal app loads in the browser. A draft or unknown page answers 404.
// vercel.json sends /p/:slug here. Reads only published pages (get_public_page,
// without counting a view), with the same public key the browser uses.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function loadPage(slug) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key || !/^[a-z0-9-]{1,60}$/.test(slug)) return null
  try {
    const r = await fetch(`${url}/rest/v1/rpc/get_public_page`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug, p_count_view: false }),
    })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  const slug = String(req.query.slug ?? '').toLowerCase()
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const [shell, page] = await Promise.all([fetch(`https://${host}/index.html`).then((r) => r.text()), loadPage(slug)])
  let html = shell
  if (page) {
    const s = page.settings ?? {}
    const title = s.seoTitle || `${page.title} · MPS Mortgage`
    const description = s.seoDescription || 'MPS Mortgage LLC · NMLS #2501110 · Dallas-Fort Worth, Texas'
    const tags = [
      `<meta name="description" content="${esc(description)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="https://${esc(host)}/p/${esc(page.slug)}">`,
      s.ogImage && /^https:\/\//.test(s.ogImage) ? `<meta property="og:image" content="${esc(s.ogImage)}">` : '',
      `<meta name="twitter:card" content="${s.ogImage ? 'summary_large_image' : 'summary'}">`,
    ].join('\n    ')
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>\n    ${tags}`)
  } else {
    html = html.replace(/<title>[^<]*<\/title>/, '<title>Page not found · MPS Mortgage</title>')
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  res.status(page ? 200 : 404).send(html)
}
