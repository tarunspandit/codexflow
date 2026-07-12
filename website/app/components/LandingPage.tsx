import type { CSSProperties } from "react";
import { CommandCopy } from "./CommandCopy";

type Locale = "en" | "zh";

const GITHUB_URL = "https://github.com/tarunspandit/codexflow";
const NPM_URL = "https://www.npmjs.com/package/@tarunspandit/codexflow";

const content = {
  en: {
    lang: "EN",
    langHref: "/zh",
    langLabel: "中文",
    nav: [
      ["How it works", "#flow"],
      ["Capabilities", "#capabilities"],
      ["Safety", "#safety"],
      ["FAQ", "#faq"],
    ],
    eyebrow: "Local-first coding infrastructure for ChatGPT",
    heroLines: ["One command.", "Every project.", "Any chat."],
    heroBody:
      "CodexFlow turns ChatGPT on the web into a project-aware coding agent for your local machine. One broker discovers your projects, one tunnel connects them, and every conversation keeps its own workspace.",
    primaryCta: "Install CodexFlow",
    secondaryCta: "Explore the flow",
    proof: ["No setup wizard", "No Codex CLI execution", "MIT licensed"],
    commandTitle: "Your entire setup",
    commandHint: "Install once. Then run from anywhere.",
    copy: "Copy command",
    copied: "Copied",
    consoleStatus: "BROKER ONLINE",
    consoleTitle: "codexflow",
    consoleLines: [
      ["discover", "8 local projects found"],
      ["tunnel", "secure HTTPS route ready"],
      ["session", "project picker advertised"],
      ["status", "waiting for ChatGPT"],
    ],
    consoleFooter: "Server URL copied to clipboard",
    metrics: [
      ["01", "broker"],
      ["∞", "conversations"],
      ["N", "local projects"],
      ["0", "manual registrations"],
    ],
    flowKicker: "Independent routing",
    flowTitle: "One tunnel. Separate worlds.",
    flowBody:
      "Each ChatGPT conversation selects a project once. From then on, every read, edit, search, git, and terminal call is routed to that folder—without exposing another chat’s workspace.",
    chats: ["Frontend polish", "API refactor", "Release audit"],
    projects: ["atlas-web", "signal-api", "codexflow"],
    broker: "CodexFlow broker",
    brokerMeta: "token protected · local only",
    routeCaption: "Per-chat project state stays isolated through one shared connection.",
    capabilitiesKicker: "Codex-like power, web-native control",
    capabilitiesTitle: "Everything the model needs. Nothing it doesn’t.",
    capabilitiesBody:
      "A deliberately bounded tool surface gives ChatGPT enough context and agency to do real work while keeping the machine, credentials, and project boundaries under your control.",
    capabilities: [
      {
        index: "01",
        title: "Project discovery",
        body: "Automatically reads local Codex project metadata and presents a visual picker in every new chat.",
        meta: "zero registration",
        tone: "cyan",
      },
      {
        index: "02",
        title: "Repository intelligence",
        body: "Maps entrypoints, symbols, dependencies, tests, and likely impact before the model starts editing.",
        meta: "bounded analysis",
        tone: "lime",
      },
      {
        index: "03",
        title: "Files + precise edits",
        body: "Read, search, write, edit, and apply guarded patches inside the selected project only.",
        meta: "workspace scoped",
        tone: "violet",
      },
      {
        index: "04",
        title: "Git-aware review",
        body: "Inspect status and diffs, surface affected areas, and keep a review checkpoint as work evolves.",
        meta: "change aware",
        tone: "orange",
      },
      {
        index: "05",
        title: "Safe terminal",
        body: "Run common inspection, build, and test commands with blocked secrets and dangerous paths by default.",
        meta: "safe bash",
        tone: "cyan",
      },
      {
        index: "06",
        title: "Skills + instructions",
        body: "Advertise AGENTS.md, local skills, plugin manifests, and configured MCP servers to the active chat.",
        meta: "project native",
        tone: "lime",
      },
    ],
    setupKicker: "From zero to coding in three moves",
    setupTitle: "No ceremony. Just flow.",
    steps: [
      {
        number: "01",
        title: "Run one command",
        body: "CodexFlow discovers projects, starts the broker, creates a token, opens the tunnel, and copies the URL.",
        code: "codexflow",
      },
      {
        number: "02",
        title: "Connect ChatGPT once",
        body: "Paste the generated Server URL into a Developer Mode plugin. No account pooling, API key, or proxy model.",
        code: "Settings → Plugins → Create",
      },
      {
        number: "03",
        title: "Pick a project per chat",
        body: "Every conversation chooses its folder independently, then resumes there for the life of that MCP session.",
        code: "list_projects → select_project",
      },
    ],
    safetyKicker: "Power with edges",
    safetyTitle: "Local access should feel serious.",
    safetyBody:
      "CodexFlow is designed around explicit boundaries, not magical trust. The public URL is token-protected, workspace roots are enforced, secrets are redacted, writes are guarded, and terminal access starts in safe mode.",
    safetyItems: [
      ["Token-protected tunnel", "Every public MCP request must carry the generated CodexFlow token."],
      ["Workspace isolation", "Tools cannot silently cross from the selected project into another root."],
      ["Secret-aware output", "Credentials and common secret patterns are blocked or redacted before transit."],
      ["No hidden agent execution", "The web tool surface never starts or resumes the actual Codex CLI."],
    ],
    safetyLink: "Read the security model",
    faqKicker: "Straight answers",
    faqTitle: "What people ask before they connect.",
    faqs: [
      [
        "Does CodexFlow run Codex behind the scenes?",
        "No. ChatGPT supplies the model and reasoning. CodexFlow supplies local project context and tools through MCP. It never starts or resumes the Codex CLI for web requests.",
      ],
      [
        "Can several chats work at the same time?",
        "Yes. One broker and tunnel can serve many conversations. Each MCP session keeps its own selected project, so chats can work independently without extra processes.",
      ],
      [
        "Do I register every repository?",
        "No. CodexFlow discovers recent project folders from local Codex metadata automatically. Optional root flags remain available for custom folders.",
      ],
      [
        "Does this bypass ChatGPT or Codex limits?",
        "No. Requests still run through your own ChatGPT account and its normal product limits. CodexFlow is a local tool bridge, not a quota proxy.",
      ],
      [
        "What happens when I restart it?",
        "A quick Cloudflare tunnel gets a fresh URL, which you paste into the plugin again. Stable Cloudflare, ngrok, and Tailscale modes are available when you want a persistent address.",
      ],
    ],
    finalKicker: "Your projects are already there",
    finalTitle: "Meet them on the web.",
    finalBody:
      "Install CodexFlow, run one command, and turn the next ChatGPT conversation into a real local coding workspace.",
    finalCta: "Get CodexFlow on npm",
    githubCta: "View source",
    footerTag: "Local code. Web intelligence.",
    trademark:
      "Independent open-source software. Not affiliated with, endorsed by, or sponsored by OpenAI.",
  },
  zh: {
    lang: "中文",
    langHref: "/",
    langLabel: "EN",
    nav: [
      ["工作方式", "#flow"],
      ["能力", "#capabilities"],
      ["安全", "#safety"],
      ["常见问题", "#faq"],
    ],
    eyebrow: "面向 ChatGPT 的本地优先代码基础设施",
    heroLines: ["一个命令。", "所有项目。", "任意聊天。"],
    heroBody:
      "CodexFlow 让网页版 ChatGPT 成为真正理解本地项目的代码代理。一个 broker 自动发现项目，一条 tunnel 完成连接，每个对话都保留自己的工作区。",
    primaryCta: "安装 CodexFlow",
    secondaryCta: "查看工作流程",
    proof: ["没有设置向导", "不执行 Codex CLI", "MIT 开源"],
    commandTitle: "这就是全部设置",
    commandHint: "只安装一次。之后在任何地方运行。",
    copy: "复制命令",
    copied: "已复制",
    consoleStatus: "BROKER 已上线",
    consoleTitle: "codexflow",
    consoleLines: [
      ["发现", "找到 8 个本地项目"],
      ["隧道", "安全 HTTPS 地址已就绪"],
      ["会话", "项目选择器已发布"],
      ["状态", "正在等待 ChatGPT"],
    ],
    consoleFooter: "Server URL 已复制到剪贴板",
    metrics: [
      ["01", "broker"],
      ["∞", "对话"],
      ["N", "本地项目"],
      ["0", "手动注册"],
    ],
    flowKicker: "独立路由",
    flowTitle: "一条隧道。彼此独立。",
    flowBody:
      "每个 ChatGPT 对话只需选择一次项目。之后所有读取、编辑、搜索、git 和终端调用都会路由到该目录，同时不会暴露其他聊天的工作区。",
    chats: ["前端打磨", "API 重构", "发布审计"],
    projects: ["atlas-web", "signal-api", "codexflow"],
    broker: "CodexFlow broker",
    brokerMeta: "token 保护 · 只在本机",
    routeCaption: "每个聊天的项目状态通过同一连接保持隔离。",
    capabilitiesKicker: "Codex 风格能力，Web 原生控制",
    capabilitiesTitle: "模型需要的一切。仅此而已。",
    capabilitiesBody:
      "经过刻意限制的工具面为 ChatGPT 提供完成真实工作的上下文和执行力，同时让机器、凭据和项目边界始终掌握在你手中。",
    capabilities: [
      { index: "01", title: "项目发现", body: "自动读取本地 Codex 项目 metadata，并在每个新聊天中显示可视化选择器。", meta: "零注册", tone: "cyan" },
      { index: "02", title: "仓库智能", body: "在编辑前识别入口、符号、依赖、测试和可能受影响的区域。", meta: "有界分析", tone: "lime" },
      { index: "03", title: "文件与精确编辑", body: "只在当前项目中读取、搜索、写入、编辑并应用受保护的补丁。", meta: "工作区范围", tone: "violet" },
      { index: "04", title: "Git 感知审查", body: "查看状态和 diff，提示受影响区域，并随着工作推进保留审查检查点。", meta: "变更感知", tone: "orange" },
      { index: "05", title: "安全终端", body: "默认允许常见检查、构建和测试命令，同时拦截 secrets 和危险路径。", meta: "安全 bash", tone: "cyan" },
      { index: "06", title: "Skills 与指令", body: "向当前聊天提供 AGENTS.md、本地 skills、plugin manifests 和已配置的 MCP server。", meta: "项目原生", tone: "lime" },
    ],
    setupKicker: "三步开始编码",
    setupTitle: "没有仪式。直接流动。",
    steps: [
      { number: "01", title: "运行一个命令", body: "CodexFlow 自动发现项目、启动 broker、创建 token、打开 tunnel 并复制 URL。", code: "codexflow" },
      { number: "02", title: "连接一次 ChatGPT", body: "把生成的 Server URL 粘贴到 Developer Mode plugin。不共享账号，不需要 API key，也不代理模型。", code: "设置 → Plugins → 创建" },
      { number: "03", title: "每个聊天选择项目", body: "每个对话独立选择目录，并在整个 MCP 会话期间持续在该项目中工作。", code: "list_projects → select_project" },
    ],
    safetyKicker: "能力必须有边界",
    safetyTitle: "本地访问应该被认真对待。",
    safetyBody:
      "CodexFlow 依靠明确边界，而不是盲目信任。公网 URL 由 token 保护，工作区 root 被严格执行，secrets 会被隐藏，写入受到保护，终端默认处于安全模式。",
    safetyItems: [
      ["Token 保护的 tunnel", "每个公网 MCP 请求都必须携带生成的 CodexFlow token。"],
      ["工作区隔离", "工具不能从当前项目悄悄跨越到另一个 root。"],
      ["Secret 感知输出", "凭据和常见 secret 模式会在传输前被拦截或隐藏。"],
      ["没有隐藏代理执行", "Web 工具面永远不会启动或恢复真正的 Codex CLI。"],
    ],
    safetyLink: "阅读安全模型",
    faqKicker: "直接回答",
    faqTitle: "连接之前，人们最常问这些。",
    faqs: [
      ["CodexFlow 会在后台运行 Codex 吗？", "不会。ChatGPT 提供模型和推理，CodexFlow 通过 MCP 提供本地项目上下文和工具。Web 请求永远不会启动或恢复 Codex CLI。"],
      ["多个聊天可以同时工作吗？", "可以。一个 broker 和 tunnel 能服务多个对话。每个 MCP 会话保存自己的项目选择，不需要额外进程。"],
      ["需要逐个注册仓库吗？", "不需要。CodexFlow 会从本地 Codex metadata 自动发现最近项目。自定义目录仍可使用可选的 root 参数。"],
      ["这会绕过 ChatGPT 或 Codex 限制吗？", "不会。请求仍通过你自己的 ChatGPT 账号和正常产品限制运行。CodexFlow 是本地工具桥，不是额度代理。"],
      ["重启后会怎样？", "Cloudflare quick tunnel 会获得新 URL，需要重新粘贴到 plugin。若需要固定地址，可使用 Cloudflare named tunnel、ngrok 或 Tailscale。"],
    ],
    finalKicker: "项目已经在你的电脑里",
    finalTitle: "现在，在 Web 上与它们相遇。",
    finalBody: "安装 CodexFlow，运行一个命令，让下一个 ChatGPT 对话成为真正的本地代码工作区。",
    finalCta: "在 npm 获取 CodexFlow",
    githubCta: "查看源码",
    footerTag: "本地代码。Web 智能。",
    trademark: "独立开源软件，与 OpenAI 没有隶属、赞助或官方背书关系。",
  },
} as const;

export function LandingPage({ locale }: { locale: Locale }) {
  const c = content[locale];

  return (
    <div className="site-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="CodexFlow home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <b>CF</b>
          </span>
          <span className="brand-word">CodexFlow</span>
          <span className="brand-version">β</span>
        </a>
        <nav className="site-nav" aria-label="Primary navigation">
          {c.nav.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a className="language-link" href={c.langHref} aria-label={`Switch to ${c.langLabel}`}>
            {c.langLabel}
          </a>
          <a className="header-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero section-frame">
          <div className="hero-copy">
            <p className="eyebrow reveal">{c.eyebrow}</p>
            <h1 className="hero-title">
              <span>{c.heroLines[0]}</span>
              <span>{c.heroLines[1]}</span>
              <span className="hero-accent">{c.heroLines[2]}</span>
            </h1>
            <p className="hero-body">{c.heroBody}</p>
            <div className="hero-actions">
              <a className="button button-primary" href={NPM_URL} target="_blank" rel="noreferrer">
                {c.primaryCta} <span aria-hidden="true">↗</span>
              </a>
              <a className="button button-ghost" href="#flow">
                {c.secondaryCta} <span aria-hidden="true">↓</span>
              </a>
            </div>
            <ul className="proof-list" aria-label="Product facts">
              {c.proof.map((item) => (
                <li key={item}><span aria-hidden="true">●</span>{item}</li>
              ))}
            </ul>
          </div>

          <div className="hero-product" aria-label="CodexFlow terminal preview">
            <div className="product-orbit orbit-one" aria-hidden="true" />
            <div className="product-orbit orbit-two" aria-hidden="true" />
            <div className="terminal-card">
              <div className="terminal-bar">
                <span className="terminal-dots" aria-hidden="true"><i /><i /><i /></span>
                <span>{c.consoleTitle}</span>
                <span className="terminal-status"><i />{c.consoleStatus}</span>
              </div>
              <div className="terminal-body">
                <p className="terminal-command"><span>$</span> codexflow</p>
                <div className="terminal-stream">
                  {c.consoleLines.map(([label, value], index) => (
                    <div className="stream-line" key={label} style={{ "--delay": `${index * 0.18}s` } as CSSProperties}>
                      <span className="stream-index">0{index + 1}</span>
                      <span className="stream-label">{label}</span>
                      <span className="stream-value">{value}</span>
                      <span className="stream-check">✓</span>
                    </div>
                  ))}
                </div>
                <div className="terminal-url">
                  <span className="url-lock" aria-hidden="true">◆</span>
                  <span>https://signal-field.trycloudflare.com/mcp</span>
                  <span className="url-token">token</span>
                </div>
                <p className="terminal-footer"><span aria-hidden="true">✓</span>{c.consoleFooter}</p>
              </div>
            </div>
            <div className="floating-chip chip-project"><span>03</span> projects active</div>
            <div className="floating-chip chip-session"><i /> session isolated</div>
          </div>

          <div className="install-ribbon">
            <div>
              <span className="install-label">{c.commandTitle}</span>
              <span className="install-hint">{c.commandHint}</span>
            </div>
            <code><span>npm</span> install -g codexflow</code>
            <CommandCopy command="npm install -g @tarunspandit/codexflow" copyLabel={c.copy} copiedLabel={c.copied} />
          </div>
        </section>

        <section className="metrics-strip" aria-label="CodexFlow metrics">
          {c.metrics.map(([value, label]) => (
            <div className="metric" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
          <div className="metric-signal" aria-hidden="true"><i /><i /><i /><i /></div>
        </section>

        <section className="flow-section section-frame" id="flow">
          <div className="section-heading flow-heading">
            <p className="section-kicker">{c.flowKicker}</p>
            <h2>{c.flowTitle}</h2>
            <p>{c.flowBody}</p>
          </div>
          <div className="routing-board">
            <div className="board-topline">
              <span>LIVE ROUTING MAP</span>
              <span><i /> 3 SESSIONS</span>
            </div>
            <div className="routing-grid">
              <div className="routing-column chat-column">
                <span className="column-label">CHATGPT</span>
                {c.chats.map((chat, index) => (
                  <div className="route-node chat-node" key={chat}>
                    <span className="node-avatar">{String.fromCharCode(65 + index)}</span>
                    <span><strong>{chat}</strong><small>conversation 0{index + 1}</small></span>
                    <i className={`route-port port-${index + 1}`} />
                  </div>
                ))}
              </div>
              <div className="route-lines" aria-hidden="true">
                <i className="line-one" /><i className="line-two" /><i className="line-three" />
              </div>
              <div className="broker-node">
                <span className="broker-pulse" aria-hidden="true"><i /><i /></span>
                <span className="broker-mark">CF</span>
                <strong>{c.broker}</strong>
                <small>{c.brokerMeta}</small>
              </div>
              <div className="route-lines route-lines-out" aria-hidden="true">
                <i className="line-one" /><i className="line-two" /><i className="line-three" />
              </div>
              <div className="routing-column project-column">
                <span className="column-label">LOCAL PROJECTS</span>
                {c.projects.map((project, index) => (
                  <div className="route-node project-node" key={project}>
                    <i className={`route-port port-${index + 1}`} />
                    <span className="folder-glyph" aria-hidden="true">⌁</span>
                    <span><strong>{project}</strong><small>~/DEV/{project}</small></span>
                    <span className="project-state">active</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="route-caption"><span aria-hidden="true">↳</span>{c.routeCaption}</p>
          </div>
        </section>

        <section className="capabilities-section section-frame" id="capabilities">
          <div className="section-heading wide-heading">
            <p className="section-kicker">{c.capabilitiesKicker}</p>
            <h2>{c.capabilitiesTitle}</h2>
            <p>{c.capabilitiesBody}</p>
          </div>
          <div className="capability-grid">
            {c.capabilities.map((capability, index) => (
              <article className={`capability-card capability-${capability.tone} capability-${index + 1}`} key={capability.title}>
                <div className="capability-top">
                  <span>{capability.index}</span>
                  <span className="capability-signal" aria-hidden="true"><i /><i /><i /></span>
                </div>
                <div>
                  <h3>{capability.title}</h3>
                  <p>{capability.body}</p>
                </div>
                <span className="capability-meta">{capability.meta}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="setup-section section-frame" id="start">
          <div className="section-heading setup-heading">
            <p className="section-kicker">{c.setupKicker}</p>
            <h2>{c.setupTitle}</h2>
          </div>
          <div className="step-grid">
            {c.steps.map((step) => (
              <article className="step-card" key={step.number}>
                <span className="step-number">{step.number}</span>
                <div className="step-copy">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
                <code>{step.code}</code>
              </article>
            ))}
          </div>
        </section>

        <section className="safety-section section-frame" id="safety">
          <div className="safety-copy">
            <p className="section-kicker">{c.safetyKicker}</p>
            <h2>{c.safetyTitle}</h2>
            <p>{c.safetyBody}</p>
            <a href={`${GITHUB_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
              {c.safetyLink} <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="safety-list">
            {c.safetyItems.map(([title, body], index) => (
              <article key={title}>
                <span className="safety-index">0{index + 1}</span>
                <div><h3>{title}</h3><p>{body}</p></div>
                <span className="safety-check" aria-hidden="true">✓</span>
              </article>
            ))}
          </div>
        </section>

        <section className="faq-section section-frame" id="faq">
          <div className="section-heading faq-heading">
            <p className="section-kicker">{c.faqKicker}</p>
            <h2>{c.faqTitle}</h2>
          </div>
          <div className="faq-list">
            {c.faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary><span>0{index + 1}</span>{question}<i aria-hidden="true">+</i></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final-section section-frame">
          <div className="final-grid" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          <p className="section-kicker">{c.finalKicker}</p>
          <h2>{c.finalTitle}</h2>
          <p>{c.finalBody}</p>
          <div className="final-actions">
            <a className="button button-primary" href={NPM_URL} target="_blank" rel="noreferrer">{c.finalCta} <span aria-hidden="true">↗</span></a>
            <a className="button button-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">{c.githubCta} <span aria-hidden="true">↗</span></a>
          </div>
          <div className="final-command">
            <code><span>$</span> codexflow</code>
            <CommandCopy command="codexflow" copyLabel={c.copy} copiedLabel={c.copied} />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true"><i /><b>CF</b></span>
          <span><strong>CodexFlow</strong><small>{c.footerTag}</small></span>
        </div>
        <div className="footer-links">
          <a href={NPM_URL} target="_blank" rel="noreferrer">npm ↗</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
          <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT</a>
          <a href={c.langHref}>{c.langLabel}</a>
        </div>
        <p>{c.trademark}</p>
      </footer>
    </div>
  );
}
