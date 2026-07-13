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
      "One command gives ChatGPT project-aware access to your local files, git, terminal, skills, and repository context through a secure MCP bridge.",
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
        "Turn ChatGPT on the web into a project-aware coding agent for your local machine.",
      url: "/",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "CodexFlow Luminous Orbit Tech identity with the line One command. Every project. Any chat." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "CodexFlow — One command. Every project. Any chat.",
      description: "Local code. Web intelligence. One secure connection.",
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
