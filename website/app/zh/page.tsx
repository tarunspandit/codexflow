import type { Metadata } from "next";
import { LandingPage } from "../components/LandingPage";

export const metadata: Metadata = {
  title: "CodexFlow — 本地代码，Web 智能",
  description: "一个命令，让 ChatGPT 通过安全 MCP bridge 使用本地项目、文件、git、终端、skills 和仓库上下文。",
  alternates: { canonical: "/zh", languages: { "en-US": "/", "zh-CN": "/zh" } },
};

export default function ChineseHome() {
  return <LandingPage locale="zh" />;
}
