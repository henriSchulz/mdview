import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Going } from "./going";

export const metadata: Metadata = {
  title: "Markdown Notes",
  description: "Notes in plain Markdown, from a repository on GitHub.",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: "/welcome/icon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "48x48" }], apple: "/welcome/icon-180.png" },
  manifest: "/welcome/app.webmanifest",
  appleWebApp: { capable: true, title: "Notes", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  colorScheme: "light dark", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", // (an app, not a page: it is not pinched larger)
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f5f7" }, { media: "(prefers-color-scheme: dark)", color: "#1e1e20" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* how the app moves and the sizes its controls share: the desktop app's own file (scripts/assets.mjs) */}
        <link rel="stylesheet" href="/app/motion.css" />
      </head>
      <body>{children}<Going /></body>
    </html>
  );
}
