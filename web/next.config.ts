import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // A commit comes as one request with its files in it — up to 20 MB of them (app/api/r/…/commit).
  // Every request passes proxy.ts first, which hands on no more than this of a body: left at its
  // 10 MB, a larger commit arrived cut off and was refused as malformed.
  experimental: { proxyClientMaxBodySize: "24mb" },
  // What every answer says about how it may be used: over https only from now on, its type not
  // guessed, not shown inside another site's page. (The pages that show notes add a policy of their own,
  // and say what they tell of where a visitor came from: lib/page.ts, lib/sharepage.ts.)
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
      ],
    }];
  },
};

export default config;
