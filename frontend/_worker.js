const BACKEND = 'https://datasage-h5et.onrender.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      const upstream = new Request(BACKEND + url.pathname + url.search, request)
      return fetch(upstream)
    }

    const asset = await env.ASSETS.fetch(request)
    if (asset.status !== 404) return asset
    return env.ASSETS.fetch(new Request(new URL('/', url), { headers: { 'Accept': 'text/html' } }))
  },
}
