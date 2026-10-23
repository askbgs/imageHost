/** @type {import("next").NextConfig} */
const nextConfig = {
  // sharp, pg and the AWS SDK are native/server-only; keep them out of the bundle.
  serverExternalPackages: ["sharp", "pg", "ioredis", "bullmq"],
  poweredByHeader: false,
  async rewrites() {
    return [
      // ImgBB-compatible public API paths: https://api.yoursite.com/1/upload
      { source: "/1/:path*", destination: "/api/1/:path*" },
    ];
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
