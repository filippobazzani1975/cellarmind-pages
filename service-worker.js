const CACHE_PREFIX = 'cellarmind-app-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v5`
const APP_SHELL = ['./manifest.webmanifest', './favicon.svg']

const isCacheableResponse = (response) =>
  response.ok && response.type !== 'opaque'

const cacheBuiltApplication = async () => {
  const cache = await caches.open(CACHE_NAME)
  const scope = self.registration.scope
  const indexUrl = new URL('./index.html', scope)
  const indexResponse = await fetch(indexUrl, { cache: 'reload' })

  if (!isCacheableResponse(indexResponse)) {
    throw new Error('Application shell unavailable')
  }

  const html = await indexResponse.clone().text()
  const assetUrls = Array.from(
    html.matchAll(/(?:src|href)="([^"]+)"/gu),
    (match) => new URL(match[1], scope),
  )
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.href)
  const appShellUrls = APP_SHELL.map((path) => new URL(path, scope).href)
  const uniqueUrls = [...new Set([...appShellUrls, ...assetUrls])]

  await cache.addAll(uniqueUrls)
  await cache.put('./index.html', indexResponse.clone())
  await cache.put('./', indexResponse)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    cacheBuiltApplication().then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isCacheableResponse(response)) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put('./', copy))
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME)
          return (
            (await cache.match('./')) ??
            (await cache.match('./index.html')) ??
            Response.error()
          )
        }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) {
        return cached
      }

      return fetch(request).then((response) => {
        if (isCacheableResponse(response)) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
