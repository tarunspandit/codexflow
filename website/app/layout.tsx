import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "CodexFlow — One command. Every project. Any chat.",
      template: "%s · CodexFlow",
    },
    description:
      "One command gives ChatGPT shared local environments, managed worktrees, guarded Git workflows, persistent terminals, and scheduled local-project runs through a secure MCP bridge.",
    applicationName: "CodexFlow",
    keywords: ["ChatGPT", "MCP", "local coding agent", "developer tools", "CodexFlow"],
    authors: [{ name: "CodexFlow contributors" }],
    creator: "CodexFlow contributors",
    alternates: {
      canonical: "/",
      languages: {
        "en-US": "/",
        "zh-CN": "/zh",
      },
    },
    openGraph: {
      type: "website",
      siteName: "CodexFlow",
      title: "CodexFlow — One command. Every project. Any chat.",
      description:
        "Parallel and scheduled local coding from ChatGPT with shared project environments, managed worktrees, persistent terminals, and private routes.",
      url: "/",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "CodexFlow Luminous Orbit Tech identity with the line Parallel work. One private route." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "CodexFlow — One command. Every project. Any chat.",
      description: "Parallel work. One private route.",
      images: ["/og.png"],
    },
    icons: {
      icon: [{ url: "/brand/favicon-64.png", type: "image/png", sizes: "64x64" }],
      shortcut: "/brand/favicon-64.png",
      apple: [{ url: "/brand/favicon-180.png", sizes: "180x180" }],
    },
    manifest: "/manifest.webmanifest",
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body>{children}</body>
    </html>
  );
}
