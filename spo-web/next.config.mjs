/** @type {import('next').NextConfig} */
const disableBuildChecks = process.env.NEXT_DISABLE_BUILD_CHECKS === "1";
const useStandaloneOutput = process.env.NEXT_OUTPUT_STANDALONE === "1";
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const resolveProxyTarget = () => {
  const rawTarget = String(process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000").trim();
  if (!rawTarget || rawTarget === "/api") return "";

  try {
    const parsed = new URL(rawTarget);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const nextConfig = {
  ...(useStandaloneOutput ? { output: "standalone" } : {}),
  devIndicators: false,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: disableBuildChecks,
  },
  typescript: {
    ignoreBuildErrors: disableBuildChecks,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async rewrites() {
    const proxyTarget = resolveProxyTarget();
    if (!proxyTarget) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${proxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
