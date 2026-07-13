import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CodexFlow",
    short_name: "CodexFlow",
    description: "Local code. Web intelligence.",
    start_url: "/",
    display: "standalone",
    background_color: "#08090b",
    theme_color: "#08090b",
    icons: [
      { src: "/brand/favicon-64.png", sizes: "64x64", type: "image/png" },
      { src: "/brand/favicon-180.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
