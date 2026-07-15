import Image from "next/image";
import { CommandCopy } from "./CommandCopy";
import { RouterPreview } from "./RouterPreview";

type Locale = "en" | "zh";

const GITHUB_URL = "https://github.com/tarunspandit/codexflow";
const NPM_URL = "https://www.npmjs.com/package/@tarunspandit/codexflow";
const SECURITY_URL = `${GITHUB_URL}/blob/main/SECURITY.md`;
const INSTALL_COMMAND = "npm install -g @tarunspandit/codexflow";

const content = {
  en: {
    langHref: "/zh",
    langLabel: "中文",
    nav: [["System", "#system"], ["Flow", "#flow"], ["Companion", "#companion"], ["Surface", "#surface"], ["Boundaries", "#safety"]],
    eyebrow: "Local agent infrastructure / Flow7 Tech",
    hero: ["One command.", "Every project.", "Any chat."],
    heroBody: "CodexFlow gives ChatGPT a serious local coding backend. Your projects, files, git, terminal, skills, and instructions become available through one deliberate connection.",
    copy: "Copy",
    copied: "Copied",
    seePath: "See the path",
    proof: ["No setup wizard", "No Codex CLI execution", "MIT licensed"],
    brokerReady: "Broker ready",
    readout: [["Connection", "Token protected"], ["Projects", "Auto-discovered"], ["Sessions", "Independently routed"]],
    systemKicker: "The operating idea",
    systemTitle: <>The model stays on the web.<br />The work stays on your machine.</>,
    systemBody: "CodexFlow is the exact layer between the two: project-aware, inspectable, and bounded to the folder each conversation chooses.",
    contract: [
      ["01 / MODEL SURFACE", "ChatGPT thinks and converses.", "Your existing ChatGPT account supplies the model, reasoning, and conversation. CodexFlow does not proxy quotas, impersonate Codex, or start hidden agent sessions."],
      ["02 / EXECUTION SURFACE", "Your computer holds the truth.", "Repository instructions, current files, git state, project skills, and bounded commands remain local until the active conversation requests them."],
      ["03 / CONNECTION LAYER", "One broker keeps the relationship clear.", "A single authenticated MCP endpoint serves many chats while preserving one independent project binding for every session."],
    ],
    flowKicker: "From zero to useful",
    flowTitle: <>Three movements.<br />No ceremony.</>,
    flowBody: "Install once. The bare command handles discovery, the broker, authentication, and the tunnel. Each new chat only chooses where it should work.",
    steps: [
      ["Start", <>Run <code>codexflow</code>.</>, "Recent projects are discovered, the local MCP broker starts, a private token is created, and a secure URL is prepared.", "$ codexflow"],
      ["Connect", <>Add the URL to ChatGPT once.</>, "Create a Developer Mode app, paste the generated Server URL, and choose no additional authentication—the token is already in the URL.", "Settings → Apps → Create"],
      ["Choose", <>Bind the chat to a project.</>, "The project picker appears inside the conversation. Select once; files, git, edits, and commands stay routed there for that session.", "~/DEV/atlas-web"],
    ],
    routingKicker: "Independent routing",
    routingTitle: <>One connection.<br />Separate working memory.</>,
    routingBody: "Every ChatGPT conversation owns its selected project. Change the active preview to see the same broker route a different task without crossing workspace boundaries.",
    metricLabels: ["broker", "chats", "projects"],
    companionKicker: "The local companion",
    companionTitle: <>Every chat,<br />in clear view.</>,
    companionBody: "The broker also serves a private application on your computer. It shows discovered projects, live routing, recent tool outcomes, connection health, and the exact policy active for this run.",
    companionLive: "Live on this computer",
    companionViews: ["Now", "Projects", "Chats", "Connection", "Policy"],
    companionMetrics: [["Projects", "Discovered"], ["Chat routes", "Independent"], ["Policy", "workspace / safe"], ["Activity", "Memory-only"]],
    companionSessions: [["Onboarding", "atlas-web", "read · completed"], ["Auth refactor", "signal-api", "test · completed"], ["Release audit", "codexflow", "git status · live"]],
    companionPrivacy: "Content-free telemetry",
    companionPrivacyBody: "Only project, tool name, outcome, and duration. Never prompts, arguments, source, command output, tokens, or usable MCP session IDs.",
    companionBoundary: "This is a product preview. The real companion is served only by your authenticated local CodexFlow process; this public website cannot see your projects or chats.",
    surfaceKicker: "The tool surface",
    surfaceTitle: <>Enough agency to work.<br />Enough structure to trust.</>,
    surfaceBody: "CodexFlow exposes a focused coding surface instead of an unbounded shell. The model gets the context and actions it needs, with each operation scoped to the chosen workspace.",
    capabilities: [
      ["Discover", "Projects are already there.", "Reads recent local project metadata and configured roots, then presents a clean picker in each new conversation.", "AUTOMATIC"],
      ["Understand", "Repository context before action.", "Loads AGENTS.md, maps files and symbols, locates tests, reads git state, and identifies likely impact before changing code.", "PROJECT NATIVE"],
      ["Change", "Precise edits inside one root.", "Search, read, write, edit, and apply guarded patches without exposing another project or wandering through the machine.", "WORKSPACE SCOPED"],
      ["Verify", "Builds and tests, deliberately.", "Runs allowlisted inspection and verification commands with secret paths and dangerous patterns blocked by default.", "SAFE BASH"],
      ["Adapt", "Your skills and plugins travel with the project.", "Advertises workspace and user skills, plugin manifests, instructions, and configured MCP servers to the active chat.", "EXTENSIBLE"],
    ],
    safetyKicker: "Power with edges",
    safetyTitle: "Local access should feel serious.",
    safetyBody: "The connection is useful because its limits are explicit. The public route requires a generated token, every file operation is root-checked, secrets are redacted, and dangerous capabilities remain opt-in.",
    safetyLink: "Read the security model",
    guards: [
      ["Token-protected public URL", "Unauthenticated requests never reach the tool surface."],
      ["Workspace root enforcement", "Path and symlink checks keep every operation in scope."],
      ["Secret-aware output", "Credentials and common secret patterns are blocked or redacted."],
      ["Guarded writes and terminal", "Safe defaults stay active until you deliberately widen them."],
    ],
    faqKicker: "Straight answers",
    faqTitle: "Before you connect.",
    faqs: [
      ["Does CodexFlow run the Codex CLI?", "No. ChatGPT supplies the model and conversation. CodexFlow supplies the local project context and tool backend through MCP. It never starts, resumes, or impersonates a Codex session."],
      ["Do I register every project manually?", "No. Running codexflow discovers recent project folders and configured roots automatically. Each conversation chooses one project for itself."],
      ["Can several chats work at once?", "Yes. One broker and one tunnel can serve many conversations. Each MCP session preserves its own project binding."],
      ["Is this a quota or model proxy?", "No. Requests still use your own ChatGPT account and its normal product limits. CodexFlow does not pool accounts, resell access, or bypass quotas."],
      ["What does installation require?", "Node.js 20 or newer and ChatGPT Apps / Developer Mode access. The normal launcher includes Cloudflare quick tunnel support and also offers stable tunnel modes."],
    ],
    finalKicker: "Your projects are already here",
    finalTitle: "Meet them in the conversation.",
    finalBody: "Install once. Run from anywhere. Choose the workspace when the chat begins.",
    thenRun: "Then run",
    footerTag: "Local code. Web intelligence.",
    expression: "A FLOW 7 / TECH EXPRESSION",
    disclaimer: "Independent open-source software. Not affiliated with, endorsed by, or sponsored by OpenAI.",
  },
  zh: {
    langHref: "/",
    langLabel: "EN",
    nav: [["系统", "#system"], ["流程", "#flow"], ["本地应用", "#companion"], ["能力", "#surface"], ["边界", "#safety"]],
    eyebrow: "本地代理基础设施 / Flow7 Tech",
    hero: ["一个命令。", "所有项目。", "任意对话。"],
    heroBody: "CodexFlow 为 ChatGPT 提供可靠的本地编码后端。项目、文件、git、终端、skills 与指令，都通过一条清晰可控的连接进入对话。",
    copy: "复制",
    copied: "已复制",
    seePath: "查看完整流程",
    proof: ["没有设置向导", "不执行 Codex CLI", "MIT 开源"],
    brokerReady: "Broker 已就绪",
    readout: [["连接", "Token 保护"], ["项目", "自动发现"], ["会话", "独立路由"]],
    systemKicker: "工作原理",
    systemTitle: <>模型留在 Web。<br />工作留在你的电脑。</>,
    systemBody: "CodexFlow 是两者之间精确的一层：理解项目、可检查，并始终被限制在每个对话自己选择的文件夹里。",
    contract: [
      ["01 / 模型层", "ChatGPT 负责思考和对话。", "你现有的 ChatGPT 账号提供模型、推理和对话。CodexFlow 不代理额度，不伪装成 Codex，也不在后台启动隐藏的代理会话。"],
      ["02 / 执行层", "你的电脑保存真实状态。", "仓库指令、当前文件、git 状态、项目 skills 和受控命令都保留在本地，只有当前对话请求时才会使用。"],
      ["03 / 连接层", "一个 broker 把关系保持清楚。", "一条经过身份验证的 MCP endpoint 可以服务多个聊天，同时为每个会话保留独立的项目绑定。"],
    ],
    flowKicker: "从零到可用",
    flowTitle: <>三个动作。<br />没有仪式。</>,
    flowBody: "安装一次。裸命令完成项目发现、broker、身份验证和 tunnel。每个新聊天只需要选择它应该在哪个项目工作。",
    steps: [
      ["启动", <>运行 <code>codexflow</code>。</>, "自动发现最近项目，启动本地 MCP broker，创建私有 token，并准备安全 URL。", "$ codexflow"],
      ["连接", <>把 URL 添加到 ChatGPT 一次。</>, "创建 Developer Mode app，粘贴生成的 Server URL，并选择无需额外身份验证—token 已经在 URL 中。", "设置 → Apps → 创建"],
      ["选择", <>把聊天绑定到一个项目。</>, "项目选择器直接出现在对话里。选择一次，文件、git、编辑与命令会在整个会话中持续路由到该项目。", "~/DEV/atlas-web"],
    ],
    routingKicker: "独立路由",
    routingTitle: <>一条连接。<br />各自的工作记忆。</>,
    routingBody: "每个 ChatGPT 对话都拥有自己选择的项目。切换预览，看看同一个 broker 如何路由不同任务，同时不跨越工作区边界。",
    metricLabels: ["broker", "对话", "项目"],
    companionKicker: "本地伴随应用",
    companionTitle: <>每个聊天，<br />都清晰可见。</>,
    companionBody: "Broker 也会在你的电脑上提供一个私有应用。它展示已发现项目、实时路由、最近工具结果、连接健康，以及本次运行真正生效的策略。",
    companionLive: "正在此电脑上运行",
    companionViews: ["当前", "项目", "聊天", "连接", "策略"],
    companionMetrics: [["项目", "自动发现"], ["聊天路由", "各自独立"], ["策略", "workspace / safe"], ["活动", "仅保存在内存"]],
    companionSessions: [["优化新手流程", "atlas-web", "read · 完成"], ["重构身份验证", "signal-api", "test · 完成"], ["发布审查", "codexflow", "git status · 运行中"]],
    companionPrivacy: "不包含内容的遥测",
    companionPrivacyBody: "只记录项目、工具名称、结果和耗时。不会记录 prompts、arguments、源码、命令输出、tokens 或可用的 MCP session IDs。",
    companionBoundary: "这是产品预览。真正的伴随应用只由你经过身份验证的本地 CodexFlow 进程提供；这个公共网站无法看到你的项目或聊天。",
    surfaceKicker: "工具能力",
    surfaceTitle: <>足够完成工作。<br />也足够清楚，值得信任。</>,
    surfaceBody: "CodexFlow 提供专注的编码能力，而不是一个没有边界的 shell。模型获得需要的上下文与操作，每一步都限定在已选工作区内。",
    capabilities: [
      ["发现", "项目已经在那里。", "读取最近的本地项目 metadata 和配置 roots，在每个新对话中提供清晰的选择器。", "自动"],
      ["理解", "行动之前先读懂仓库。", "加载 AGENTS.md，映射文件和符号，定位测试，读取 git 状态，并在改动前识别潜在影响。", "项目原生"],
      ["修改", "在一个 root 中精确编辑。", "搜索、读取、写入、编辑并应用受保护补丁，不暴露其他项目，也不在机器中越界。", "工作区范围"],
      ["验证", "有意识地构建与测试。", "运行允许的检查与验证命令，默认阻止 secret 路径和危险模式。", "安全 BASH"],
      ["适配", "Skills 与 plugins 跟随项目。", "向当前聊天提供工作区与用户 skills、plugin manifests、指令以及已配置的 MCP servers。", "可扩展"],
    ],
    safetyKicker: "能力必须有边界",
    safetyTitle: "本地访问应该被认真对待。",
    safetyBody: "这条连接之所以有用，正因为它的限制是明确的。公网路由需要生成的 token，每个文件操作都经过 root 检查，secrets 会被隐藏，危险能力始终需要主动开启。",
    safetyLink: "阅读安全模型",
    guards: [["Token 保护的公网 URL", "未经身份验证的请求无法进入工具面。"], ["工作区 root 强制执行", "路径与 symlink 检查让所有操作始终在范围内。"], ["Secret 感知输出", "凭据和常见 secret 模式会被拦截或隐藏。"], ["受保护写入与终端", "安全默认值一直生效，直到你明确扩大权限。"]],
    faqKicker: "直接回答",
    faqTitle: "连接之前。",
    faqs: [["CodexFlow 会运行 Codex CLI 吗？", "不会。ChatGPT 提供模型与对话，CodexFlow 通过 MCP 提供本地项目上下文和工具后端。它不会启动、恢复或伪装成 Codex session。"], ["需要手动注册每个项目吗？", "不需要。运行 codexflow 会自动发现最近项目文件夹和配置 roots。每个对话为自己选择一个项目。"], ["多个聊天可以同时工作吗？", "可以。一个 broker 和 tunnel 能服务多个对话，每个 MCP session 都保留自己的项目绑定。"], ["这是额度或模型代理吗？", "不是。请求仍使用你自己的 ChatGPT 账号和正常产品限制。CodexFlow 不合并账号、不转售访问，也不绕过额度。"], ["安装需要什么？", "Node.js 20 或更高版本，以及 ChatGPT Apps / Developer Mode 访问。普通启动流程包含 Cloudflare quick tunnel，也支持固定 tunnel 模式。"]],
    finalKicker: "项目已经在你的电脑里",
    finalTitle: "现在，在对话中与它们相遇。",
    finalBody: "安装一次，从任何目录运行，在聊天开始时选择工作区。",
    thenRun: "然后运行",
    footerTag: "本地代码，Web 智能。",
    expression: "FLOW 7 / TECH EXPRESSION",
    disclaimer: "独立开源软件，与 OpenAI 没有隶属、赞助或官方背书关系。",
  },
} as const;

export function LandingPage({ locale }: { locale: Locale }) {
  const c = content[locale];

  return (
    <div className="site-page" lang={locale === "zh" ? "zh-CN" : "en"}>
      <a className="skip-link" href="#main">{locale === "zh" ? "跳到主要内容" : "Skip to content"}</a>
      <header className="site-header is-scrolled">
        <div className="header-shell">
          <a className="brand-lockup" href="#top" aria-label="CodexFlow home">
            <Image src="/brand/flow7-tech-dark.webp" alt="" width={1024} height={1024} />
            <span className="brand-copy"><strong>CodexFlow</strong><small>FLOW 7 / TECH</small></span>
          </a>
          <nav className="primary-nav" aria-label="Primary navigation">
            {c.nav.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
          </nav>
          <div className="header-actions"><a href={c.langHref}>{c.langLabel}</a><a className="header-cta" href={GITHUB_URL}>GitHub <span aria-hidden="true">↗</span></a></div>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="hero-image" aria-hidden="true"><Image src="/brand/tech.webp" alt="" fill priority sizes="100vw" /></div>
          <div className="hero-veil" aria-hidden="true" />
          <div className="hero-grid section-shell">
            <div className="hero-copy">
              <p className="eyebrow">{c.eyebrow}</p>
              <h1>{c.hero.map((line) => <span key={line}>{line}</span>)}</h1>
              <p className="hero-lede">{c.heroBody}</p>
              <div className="hero-actions">
                <div className="command-control"><span aria-hidden="true">$</span><code>npm i -g @tarunspandit/codexflow</code><CommandCopy command={INSTALL_COMMAND} copyLabel={c.copy} copiedLabel={c.copied} /></div>
                <a className="quiet-link" href="#flow">{c.seePath} <span aria-hidden="true">↓</span></a>
              </div>
              <ul className="hero-proof">{c.proof.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ul>
            </div>
            <div className="hero-instrument">
              <Image className="hero-mark" src="/brand/flow7-tech-dark.webp" alt="" width={1024} height={1024} priority />
              <div className="instrument-readout"><p><span className="live-dot" aria-hidden="true" />{c.brokerReady}</p><dl>{c.readout.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
            </div>
          </div>
          <div className="hero-foot section-shell" aria-hidden="true"><span>CODEXFLOW / 0.29</span><span>LOCAL MACHINE → CHATGPT</span><span>SCROLL TO ENTER</span></div>
        </section>

        <section className="system section-pad" id="system">
          <div className="section-shell">
            <div className="section-heading"><p className="eyebrow dark-label">{c.systemKicker}</p><h2>{c.systemTitle}</h2><p>{c.systemBody}</p></div>
            <div className="contract-grid">{c.contract.map(([index, title, body]) => <article key={index}><span className="contract-index">{index}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
          </div>
        </section>

        <section className="flow section-pad" id="flow">
          <div className="section-shell">
            <div className="section-heading split-heading"><div><p className="eyebrow">{c.flowKicker}</p><h2>{c.flowTitle}</h2></div><p>{c.flowBody}</p></div>
            <ol className="flow-list">{c.steps.map(([label, title, body, proof], index) => <li key={label}><span className="step-number">0{index + 1}</span><div><p className="micro-label">{label}</p><h3>{title}</h3></div><p>{body}</p><div className="step-proof"><code>{proof}</code><span><i />{locale === "zh" ? "就绪" : "ready"}</span></div></li>)}</ol>
          </div>
        </section>

        <section className="routing section-pad">
          <div className="section-shell routing-layout">
            <div className="routing-copy"><p className="eyebrow">{c.routingKicker}</p><h2>{c.routingTitle}</h2><p>{c.routingBody}</p><div className="routing-metrics"><div><strong>01</strong><span>{c.metricLabels[0]}</span></div><div><strong>∞</strong><span>{c.metricLabels[1]}</span></div><div><strong>N</strong><span>{c.metricLabels[2]}</span></div></div></div>
            <RouterPreview locale={locale} />
          </div>
        </section>

        <section className="companion section-pad" id="companion" aria-labelledby="companion-title">
          <div className="section-shell">
            <div className="section-heading companion-heading">
              <div><p className="eyebrow dark-label">{c.companionKicker}</p><h2 id="companion-title">{c.companionTitle}</h2></div>
              <p>{c.companionBody}</p>
            </div>
            <div className="companion-frame" aria-label={locale === "zh" ? "CodexFlow 本地伴随应用预览" : "CodexFlow local companion preview"}>
              <aside className="companion-rail">
                <div className="companion-lockup"><Image src="/brand/flow7-tech-dark.webp" alt="" width={1024} height={1024} /><span><strong>CodexFlow</strong><small>local companion</small></span></div>
                <div className="companion-ready"><i aria-hidden="true" /><span>{c.companionLive}</span></div>
                <ol>{c.companionViews.map((view, index) => <li className={index === 0 ? "is-active" : ""} key={view}><span>0{index + 1}</span>{view}</li>)}</ol>
                <small>ENDORSED BY FLOW7</small>
              </aside>
              <div className="companion-stage">
                <header><span>CodexFlow / <strong>{c.companionViews[0]}</strong></span><small>{c.companionLive}</small></header>
                <div className="companion-content">
                  <div className="companion-intro"><small>{locale === "zh" ? "当前运行" : "CURRENT RUN"}</small><h3>{locale === "zh" ? "你的电脑，清晰可见。" : "Your machine. In clear view."}</h3></div>
                  <dl className="companion-metrics">{c.companionMetrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                  <div className="companion-ledgers">
                    <section aria-label={locale === "zh" ? "聊天路由" : "Chat routing"}>
                      <div className="companion-panel-head"><span>01 / {locale === "zh" ? "实时路由" : "LIVE ROUTING"}</span><strong>{locale === "zh" ? "进行中的聊天" : "Chats in motion"}</strong></div>
                      <ol>{c.companionSessions.map(([chat, project, state], index) => <li key={chat}><i aria-hidden="true" /><div><strong>{chat}</strong><code>{project}</code></div><span>{state}</span><small>chat-{["a40c97f2", "7eac13b8", "29d1f640"][index]}</small></li>)}</ol>
                    </section>
                    <aside><span>02 / {locale === "zh" ? "隐私" : "PRIVACY"}</span><strong>{c.companionPrivacy}</strong><p>{c.companionPrivacyBody}</p></aside>
                  </div>
                </div>
              </div>
            </div>
            <p className="companion-boundary"><span aria-hidden="true">↳</span>{c.companionBoundary}</p>
          </div>
        </section>

        <section className="surface section-pad" id="surface">
          <div className="section-shell"><div className="section-heading"><p className="eyebrow dark-label">{c.surfaceKicker}</p><h2>{c.surfaceTitle}</h2><p>{c.surfaceBody}</p></div><div className="capability-ledger">{c.capabilities.map(([label, title, body, meta], index) => <article key={label}><span>0{index + 1}</span><div><p className="micro-label">{label}</p><h3>{title}</h3></div><p>{body}</p><small>{meta}</small></article>)}</div></div>
        </section>

        <section className="safety section-pad" id="safety">
          <div className="section-shell safety-layout"><div className="safety-copy"><p className="eyebrow">{c.safetyKicker}</p><h2>{c.safetyTitle}</h2><p>{c.safetyBody}</p><a className="quiet-link" href={SECURITY_URL}>{c.safetyLink} <span aria-hidden="true">↗</span></a></div><ol className="guard-ledger">{c.guards.map(([title, body], index) => <li key={title}><span>0{index + 1}</span><div><strong>{title}</strong><p>{body}</p></div></li>)}</ol></div>
        </section>

        <section className="faq section-pad" id="faq">
          <div className="section-shell faq-layout"><div className="faq-heading"><p className="eyebrow">{c.faqKicker}</p><h2>{c.faqTitle}</h2></div><div className="faq-list">{c.faqs.map(([question, answer], index) => <details key={question} open={index === 0 ? true : undefined}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div>
        </section>

        <section className="final-cta">
          <div className="final-image" aria-hidden="true"><Image src="/brand/hero-blue-hour.webp" alt="" fill sizes="100vw" /></div><div className="final-veil" aria-hidden="true" />
          <div className="section-shell final-layout"><div><p className="eyebrow">{c.finalKicker}</p><h2>{c.finalTitle}</h2><p>{c.finalBody}</p></div><div className="final-action"><div className="command-control command-large"><span>$</span><code>npm i -g @tarunspandit/codexflow</code><CommandCopy command={INSTALL_COMMAND} copyLabel={c.copy} copiedLabel={c.copied} /></div><p>{c.thenRun} <code>codexflow</code></p></div></div>
        </section>
      </main>

      <footer className="site-footer"><div className="section-shell footer-layout"><div className="footer-brand"><Image src="/brand/flow7-parent-dark.webp" alt="" width={1024} height={1024} /><span><strong>CodexFlow</strong><small>{c.expression}</small></span></div><p>{c.footerTag}</p><nav><a href={GITHUB_URL}>GitHub</a><a href={NPM_URL}>npm</a><a href={SECURITY_URL}>Security</a><a href={c.langHref}>{c.langLabel}</a></nav><small>{c.disclaimer}</small></div></footer>
    </div>
  );
}
