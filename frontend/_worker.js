const BACKEND = 'https://datasage-65634205430.us-central1.run.app'

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
