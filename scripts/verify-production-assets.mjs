const defaultOrigins = [
  "http://127.0.0.1:3000",
  "http://127.0.0.1",
  "https://www.zlaction.online",
]

const origins = (process.env.VERIFY_ORIGINS ?? defaultOrigins.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

const routes = (process.env.VERIFY_ROUTES ?? "/,/admin")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean)

const hostHeader = process.env.VERIFY_HOST ?? "www.zlaction.online"
const failures = []

for (const origin of origins) {
  for (const route of routes) {
    await verifyRoute(origin, route)
  }
}

if (failures.length > 0) {
  console.error("Production asset verification failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("Production asset verification passed.")

async function verifyRoute(origin, route) {
  const pageUrl = new URL(route, origin)
  const pageResponse = await request(pageUrl)

  if (!pageResponse.ok) {
    failures.push(`${pageUrl.href} returned ${pageResponse.status}.`)
    return
  }

  const cacheControl = pageResponse.headers.get("cache-control") ?? ""
  if (route === "/" && !/\bno-store\b/i.test(cacheControl)) {
    failures.push(`${pageUrl.href} must include Cache-Control no-store, got "${cacheControl || "<empty>"}".`)
  }

  const html = await pageResponse.text()
  const assetPaths = extractNextStaticAssetPaths(html)

  if (assetPaths.length === 0) {
    failures.push(`${pageUrl.href} did not reference any /_next/static assets.`)
    return
  }

  await Promise.all(
    assetPaths.map(async (assetPath) => {
      const assetUrl = new URL(assetPath, origin)
      const assetResponse = await request(assetUrl, { method: "HEAD" })
      if (!assetResponse.ok) {
        failures.push(`${assetUrl.href} returned ${assetResponse.status}.`)
      }
    }),
  )
}

function extractNextStaticAssetPaths(html) {
  const paths = new Set()
  const pattern = /\/_next\/static\/[^"'\\?#]+/g
  let match = pattern.exec(html)

  while (match) {
    paths.add(match[0])
    match = pattern.exec(html)
  }

  return [...paths].sort()
}

function request(url, init = {}) {
  const headers = new Headers(init.headers)
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    headers.set("Host", hostHeader)
  }

  return fetch(url, {
    redirect: "manual",
    ...init,
    headers,
  }).catch((error) => ({
    ok: false,
    status: error instanceof Error ? error.message : "request failed",
    headers: new Headers(),
    text: async () => "",
  }))
}
