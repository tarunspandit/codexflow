import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "CodexFlow — Local code. Web intelligence.",
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
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "CodexFlow routing local projects into independent ChatGPT coding sessions" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "CodexFlow — Local code. Web intelligence.",
      description: "One broker. Every local project. Independent ChatGPT coding sessions.",
      images: ["/og.png"],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
