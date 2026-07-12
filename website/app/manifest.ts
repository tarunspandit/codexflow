import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CodexFlow",
    short_name: "CodexFlow",
    description: "Local code. Web intelligence.",
    start_url: "/",
    display: "standalone",
    background_color: "#080a0c",
    theme_color: "#080a0c",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
