const supabaseHostname = (() => {
  try {
    return new globalThis.URL(globalThis.process?.env?.NEXT_PUBLIC_SUPABASE_URL ?? "https://www.zlaction.online").hostname
  } catch {
    return "www.zlaction.online"
  }
})()

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["107.173.25.225"],
  images: {
    formats: ["image/webp"],
    imageSizes: [32, 48, 64, 96, 128, 256, 384, 640, 828, 1080, 1200],
    minimumCacheTTL: 14400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/supabase/storage/v1/object/public/generated-images/**",
      },
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/generated-images/**",
      },
    ],
  },
}

export default nextConfig
