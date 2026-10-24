/** @type {import("next").NextConfig} */
const nextConfig = {
  // sharp, pg and the AWS SDK are native/server-only; keep them out of the bundle.
  serverExternalPackages: ["sharp", "pg", "ioredis", "bullmq"],
  poweredByHeader: false,
  async rewrites() {
    return {
      // Versioned public API: https://yoursite.com/v1/upload → app/api/v1/upload.
      // A new version is a new folder (app/api/v2/...); older versions keep working alongside it.
      beforeFiles: [
        { source: "/:version(v\\d+)/:path*", destination: "/api/:version/:path*" },
        // The first release used /1/... (and /api/1/...). They stay as aliases of v1 so saved
        // integrations (ShareX, n8n, WordPress) keep working.
        { source: "/1/:path*", destination: "/api/v1/:path*" },
        { source: "/api/1/:path*", destination: "/api/v1/:path*" },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
