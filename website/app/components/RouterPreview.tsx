"use client";

import { useState } from "react";

type Locale = "en" | "zh";

const sessions = {
  en: {
    atlas: { label: "Onboarding", task: "Polish onboarding", id: "route_3f8a…c21e", project: "atlas-web", path: "~/DEV/atlas-web", terminal: "private route bound · skills loaded · ready" },
    signal: { label: "Auth refactor", task: "Refactor authentication", id: "route_706c…8d42", project: "signal-api", path: "~/DEV/signal-api", terminal: "repository mapped · tests located · ready" },
    flow: { label: "Release audit", task: "Audit the release", id: "route_b24e…190f", project: "codexflow", path: "~/DEV/codexflow", terminal: "git clean · package verified · ready" },
  },
  zh: {
    atlas: { label: "新手流程", task: "优化新手流程", id: "route_3f8a…c21e", project: "atlas-web", path: "~/DEV/atlas-web", terminal: "私有路由已绑定 · skills 已加载 · 就绪" },
    signal: { label: "身份验证", task: "重构身份验证", id: "route_706c…8d42", project: "signal-api", path: "~/DEV/signal-api", terminal: "仓库已映射 · 测试已定位 · 就绪" },
    flow: { label: "发布审查", task: "审查发布版本", id: "route_b24e…190f", project: "codexflow", path: "~/DEV/codexflow", terminal: "git 干净 · package 已验证 · 就绪" },
  },
} as const;

type SessionKey = keyof typeof sessions.en;

export function RouterPreview({ locale }: { locale: Locale }) {
  const [active, setActive] = useState<SessionKey>("atlas");
  const session = sessions[locale][active];

  return (
    <div className="router" aria-label={locale === "zh" ? "交互式项目路由器" : "Interactive project router"}>
      <header className="router-head"><span>{locale === "zh" ? "会话路由" : "SESSION ROUTER"}</span><span><i />{locale === "zh" ? "本地 / 就绪" : "LOCAL / READY"}</span></header>
      <div className="session-tabs" role="tablist" aria-label={locale === "zh" ? "预览已路由的对话" : "Preview a routed chat"}>
        {(Object.keys(sessions[locale]) as SessionKey[]).map((key, index) => (
          <button
            className={key === active ? "is-active" : undefined}
            type="button"
            role="tab"
            key={key}
            aria-selected={key === active}
            tabIndex={key === active ? 0 : -1}
            onClick={() => setActive(key)}
          >
            <span>0{index + 1}</span>{sessions[locale][key].label}
          </button>
        ))}
      </div>
      <div className="route-field">
        <div className="route-endpoint chat-endpoint"><small>{locale === "zh" ? "CHATGPT 会话" : "CHATGPT SESSION"}</small><strong>{session.task}</strong><code>{session.id}</code></div>
        <div className="route-path" aria-hidden="true"><span /><i /></div>
        <div className="route-core"><b>CF</b><span>{locale === "zh" ? "token 保护" : "token protected"}</span></div>
        <div className="route-path outbound" aria-hidden="true"><span /><i /></div>
        <div className="route-endpoint project-endpoint"><small>{locale === "zh" ? "已选项目" : "SELECTED PROJECT"}</small><strong>{session.project}</strong><code>{session.path}</code></div>
      </div>
      <footer className="router-foot"><span>›</span><code>{session.terminal}</code><b>✓</b></footer>
    </div>
  );
}
