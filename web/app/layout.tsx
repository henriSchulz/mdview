import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Markdown Notes",
  description: "Notes in plain Markdown, from a repository on GitHub.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: "light dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* how the app moves and the sizes its controls share: the desktop app's own file (scripts/assets.mjs) */}
        <link rel="stylesheet" href="/app/motion.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
