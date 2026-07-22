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
    nav: [["System", "#system"], ["Flow", "#flow"], ["Desktop app", "#companion"], ["Surface", "#surface"], ["Boundaries", "#safety"]],
    eyebrow: "Local agent infrastructure / Flow7 Tech",
    hero: ["One command.", "Every project.", "Any chat."],
    heroBody: "CodexFlow gives ChatGPT a serious local coding backend. Projects, live task and subagent progress, worktrees, Git, persistent terminals, native review, scheduled runs, Computer Use, and an annotatable ephemeral browser become available through one deliberate connection.",
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
      ["01 / MODEL SURFACE", "ChatGPT thinks and converses.", "Your existing ChatGPT account supplies the model, reasoning, and conversation. When ChatGPT Work creates subagents, CodexFlow gives each one a private project route; it never starts or proxies the model."],
      ["02 / EXECUTION SURFACE", "Your computer holds the truth.", "Repository instructions, current files, git state, project skills, and bounded commands remain local until the active conversation requests them."],
      ["03 / CONNECTION LAYER", "One broker keeps the relationship clear.", "A single authenticated MCP endpoint serves many chats while preserving one private, durable project route for every conversation."],
    ],
    flowKicker: "From zero to useful",
    flowTitle: <>Three movements.<br />No ceremony.</>,
    flowBody: "Install once. The bare command handles discovery, the broker, authentication, and the tunnel. Each new chat only chooses where it should work.",
    steps: [
      ["Start", <>Run <code>codexflow</code>.</>, "Recent projects are discovered, the broker starts, a private token is created, and the native CodexFlow app opens automatically.", "$ codexflow"],
      ["Connect", <>Add the URL to ChatGPT once.</>, "Create a Developer Mode app, paste the generated Server URL, and choose no additional authentication—the token is already in the URL.", "Settings → Apps → Create"],
      ["Choose", <>Bind the chat to a project.</>, "Pick inside the conversation or reply with an exact project name. CodexFlow carries the private route into every later tool call and restores it after broker restarts.", "~/DEV/atlas-web"],
    ],
    modelNote: "MODEL COMPATIBILITY",
    modelTitle: "Use Extra High or another non-Pro model.",
    modelBody: "ChatGPT’s Pro model variants do not expose Apps. A Pro subscription is supported; if CodexFlow is absent from a response, switch the model—not your local broker.",
    routingKicker: "Independent routing",
    routingTitle: <>One connection.<br />Separate working memory.</>,
    routingBody: "Every ChatGPT conversation owns its selected project. Change the active preview to see the same broker route a different task without crossing workspace boundaries.",
    metricLabels: ["broker", "chats", "projects"],
    companionKicker: "The native desktop app",
    companionTitle: <>Your machine.<br />One clear surface.</>,
    companionBody: "CodexFlow opens as a native app on your Mac. Supervise routed web tasks, nested Active/Done agents, plans, blockers, environments, worktrees, diffs, SSH hosts, Computer Use, and website-origin approvals from one surface.",
    companionLive: "Live on this computer",
    companionViews: ["Now", "Projects", "Environments", "Worktrees", "Changes", "Tasks", "Hosts", "Computer", "Browser", "Connection", "Policy"],
    companionMetrics: [["Projects", "Discovered"], ["Environments", "Shared"], ["Chat routes", "Independent"], ["Terminal", "Route-persistent"]],
    companionSessions: [["Onboarding", "atlas-web", "2 agents · live"], ["Auth refactor", "signal-api", "reviewer · done"], ["Release audit", "codexflow", "git status · live"]],
    companionPrivacy: "Bounded local progress",
    companionPrivacyBody: "Project, tool outcome, and duration stay content-free. Only labels, review notes, bounded task plans, and short agent roles, states, and outcomes persist owner-only; prompts, source, command output, tokens, transport IDs, and child route credentials do not.",
    companionBoundary: "This is a representative native-app preview. The real desktop app reads only your authenticated local CodexFlow broker; this public website cannot see your projects or chats. The browser page remains a small recovery fallback.",
    surfaceKicker: "The tool surface",
    surfaceTitle: <>Enough agency to work.<br />Enough structure to trust.</>,
    surfaceBody: "CodexFlow exposes a focused coding surface instead of an unbounded shell. The model gets the context and actions it needs, with each operation scoped to the chosen workspace.",
    capabilities: [
      ["Discover", "Projects are already there.", "Reads recent local project metadata and configured roots, then presents a clean picker in each new conversation.", "AUTOMATIC"],
      ["Understand", "Repository context before action.", "Loads AGENTS.md, maps files and symbols, locates tests, reads git state, and identifies likely impact before changing code.", "PROJECT NATIVE"],
      ["Change", "Precise edits inside one root.", "Search, read, write, edit, and apply guarded patches without exposing another project or wandering through the machine.", "WORKSPACE SCOPED"],
      ["Parallelize", "One task, one managed checkout.", "Creates isolated worktrees locally or on an approved SSH host, carries current changes in safely, and refuses to overwrite a destination that changed independently.", "GUARDED HANDOFF"],
      ["Coordinate", "Every real child gets its own route.", "When ChatGPT Work spawns subagents, the parent allocates independent project routes, children report only their own bounded state, and native Tasks mirrors Active and Done work without starting another model backend.", "CHATGPT WORK / ROUTE ISOLATED"],
      ["Verify", "Git and terminal state that continue.", "Stages and commits only the selected project, runs bounded verification, and keeps a private route terminal alive across tool transports.", "PERSISTENT"],
      ["Review", "The diff belongs on your machine.", "Separates staged and unstaged files, stages or reverts one hunk at a time, and carries line-anchored review notes into the web chat’s next change review.", "NATIVE"],
      ["Adapt", "Your project environment travels too.", "Uses the same checked-in Codex environment format for setup, cleanup, named actions, skills, plugins, and MCP inventory—without running Codex.", "INTEROPERABLE"],
      ["Schedule", "Recurring work keeps its project.", "Prepares durable ChatGPT Scheduled runs that reacquire a private route and use a clean managed worktree without adding another model backend.", "CHATGPT NATIVE"],
      ["Remote", "The same picker reaches another machine.", "Approve a named OpenSSH host, then keep isolated terminals, Codex environments, project skills, repository analysis, managed worktrees, guarded handoff, file edits, Bash, and Git review on that route—without invoking Codex there.", "REMOTE WORKSPACE LIVE"],
      ["Operate", "Visual work still asks first.", "Request one signed native app from chat, approve it on the Mac, inspect a fresh window snapshot, and confirm each sensitive element-targeted action locally.", "COMPUTER USE / CONSENTED"],
      ["Browse", "Review the rendered page together.", "Approve one website origin, inspect and operate its semantic DOM in a visible ephemeral WebKit tab, then select exact elements and leave route-private comments for the web chat. Redirects, downloads, credentials, and sensitive actions fail closed or ask locally.", "WEBKIT / ORIGIN SCOPED"],
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
      ["Conflict-aware worktrees", "Handoffs fingerprint both checkouts before any destination state is replaced."],
      ["Trusted environment boundary", "Project setup and action scripts run only when workspace writes and shell execution are enabled."],
      ["Contained SSH project routing", "Concrete aliases and existing host-key trust are required; every call rechecks the destination, canonical project root, blocked paths, symlinks, and policy."],
      ["Code-signing-bound app control", "Computer Use grants bind to the target binary identity; terminal, browser, ChatGPT, system-settings, secure-field, and secret-input paths are refused."],
      ["Ephemeral browser isolation", "Each browser tab has a non-persistent WebKit profile. Origin grants are scoped, meaningful actions are sealed to fresh snapshots, and exact-element comments stay memory-only and private to their chat route."],
    ],
    faqKicker: "Straight answers",
    faqTitle: "Before you connect.",
    faqs: [
      ["Does CodexFlow run the Codex CLI?", "No. ChatGPT supplies the model and conversation. CodexFlow supplies the local project context and tool backend through MCP. It never starts, resumes, or impersonates a Codex session."],
      ["Do I register every project manually?", "No. Running codexflow discovers recent project folders and configured roots automatically. Each conversation chooses one project for itself."],
      ["Can several chats work at once?", "Yes. One broker and one tunnel can serve many conversations. Each chat gets a private route that survives separate tool connections and broker restarts."],
      ["Can one task use subagents?", "Yes, when ChatGPT Work provides them. ChatGPT owns the child threads and model usage; CodexFlow gives each actual child an isolated project route, collects bounded status and results, and shows Active/Done state in the native app."],
      ["Can scheduled tasks use my local project?", "Yes. ChatGPT Scheduled owns the model turn and cadence; CodexFlow prepares each run to reacquire the project, environment, and an optional clean worktree. Keep the computer and broker running."],
      ["Is this a quota or model proxy?", "No. Requests still use your own ChatGPT account and its normal product limits. CodexFlow does not pool accounts, resell access, or bypass quotas."],
      ["What does installation require?", "Node.js 20 or newer, macOS 14 or newer for the native app, and ChatGPT Apps / Developer Mode access. The launcher installs and opens the app automatically; no separate desktop setup is required."],
    ],
    finalKicker: "Your projects are already here",
    finalTitle: "Meet them in the conversation.",
    finalBody: "Install once. Run from anywhere. The native app opens; each chat chooses its workspace when it begins.",
    thenRun: "Then run",
    footerTag: "Local code. Web intelligence.",
    expression: "A FLOW 7 / TECH EXPRESSION",
    disclaimer: "Independent open-source software. Not affiliated with, endorsed by, or sponsored by OpenAI.",
  },
  zh: {
    langHref: "/",
    langLabel: "EN",
    nav: [["系统", "#system"], ["流程", "#flow"], ["桌面应用", "#companion"], ["能力", "#surface"], ["边界", "#safety"]],
    eyebrow: "本地代理基础设施 / Flow7 Tech",
    hero: ["一个命令。", "所有项目。", "任意对话。"],
    heroBody: "CodexFlow 为 ChatGPT 提供可靠的本地编码后端。项目、实时任务与 subagent 进度、worktrees、Git、持久终端、原生审查、定时任务、Computer Use 与可标注的临时浏览器，都通过一条清晰可控的连接进入对话。",
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
      ["01 / 模型层", "ChatGPT 负责思考和对话。", "你现有的 ChatGPT 账号提供模型、推理和对话。当 ChatGPT Work 创建 subagents 时，CodexFlow 只为每个 child 提供私有项目 route；它不会启动或代理模型。"],
      ["02 / 执行层", "你的电脑保存真实状态。", "仓库指令、当前文件、git 状态、项目 skills 和受控命令都保留在本地，只有当前对话请求时才会使用。"],
      ["03 / 连接层", "一个 broker 把关系保持清楚。", "一条经过身份验证的 MCP endpoint 可以服务多个聊天，同时为每个会话保留独立的项目绑定。"],
    ],
    flowKicker: "从零到可用",
    flowTitle: <>三个动作。<br />没有仪式。</>,
    flowBody: "安装一次。裸命令完成项目发现、broker、身份验证和 tunnel。每个新聊天只需要选择它应该在哪个项目工作。",
    steps: [
      ["启动", <>运行 <code>codexflow</code>。</>, "自动发现最近项目，启动 broker，创建私有 token，并自动打开原生 CodexFlow 应用。", "$ codexflow"],
      ["连接", <>把 URL 添加到 ChatGPT 一次。</>, "创建 Developer Mode app，粘贴生成的 Server URL，并选择无需额外身份验证—token 已经在 URL 中。", "设置 → Apps → 创建"],
      ["选择", <>把聊天绑定到一个项目。</>, "可以在对话内选择，也可以回复准确的项目名称。CodexFlow 会把私有路由带入之后的每次工具调用，并在 broker 重启后恢复绑定。", "~/DEV/atlas-web"],
    ],
    modelNote: "模型兼容性",
    modelTitle: "使用 Extra High 或其他非 Pro 模型。",
    modelBody: "ChatGPT 的 Pro 模型变体不会开放 Apps。Pro 订阅本身可以使用；如果回复中没有 CodexFlow，请切换模型，而不是重启本地 broker。",
    routingKicker: "独立路由",
    routingTitle: <>一条连接。<br />各自的工作记忆。</>,
    routingBody: "每个 ChatGPT 对话都拥有自己选择的项目。切换预览，看看同一个 broker 如何路由不同任务，同时不跨越工作区边界。",
    metricLabels: ["broker", "对话", "项目"],
    companionKicker: "原生桌面应用",
    companionTitle: <>你的电脑。<br />一个清晰界面。</>,
    companionBody: "CodexFlow 会在 Mac 上打开原生应用。统一监督 web 任务、嵌套 Active / Done agents、计划、阻塞、环境、worktrees、diff、SSH hosts、Computer Use 与网站 origin 审批。",
    companionLive: "正在此电脑上运行",
    companionViews: ["当前", "项目", "环境", "Worktrees", "改动", "任务", "Hosts", "Computer", "Browser", "连接", "策略"],
    companionMetrics: [["项目", "自动发现"], ["环境", "项目共享"], ["聊天路由", "各自独立"], ["终端", "随路由持久"]],
    companionSessions: [["优化新手流程", "atlas-web", "2 agents · 运行中"], ["重构身份验证", "signal-api", "reviewer · 完成"], ["发布审查", "codexflow", "git status · 运行中"]],
    companionPrivacy: "受限的本地进度",
    companionPrivacyBody: "项目、工具结果和耗时保持无内容遥测。只有标签、review notes、受限任务计划，以及短 agent 角色、状态与结果会 owner-only 保存；prompts、源码、命令输出、tokens、transport IDs 与 child route 凭据不会保留。",
    companionBoundary: "这是原生应用的示意预览。真正的桌面应用只读取你本机经过身份验证的 CodexFlow broker；此公共网站无法看到你的项目或聊天。浏览器页面只保留为精简恢复入口。",
    surfaceKicker: "工具能力",
    surfaceTitle: <>足够完成工作。<br />也足够清楚，值得信任。</>,
    surfaceBody: "CodexFlow 提供专注的编码能力，而不是一个没有边界的 shell。模型获得需要的上下文与操作，每一步都限定在已选工作区内。",
    capabilities: [
      ["发现", "项目已经在那里。", "读取最近的本地项目 metadata 和配置 roots，在每个新对话中提供清晰的选择器。", "自动"],
      ["理解", "行动之前先读懂仓库。", "加载 AGENTS.md，映射文件和符号，定位测试，读取 git 状态，并在改动前识别潜在影响。", "项目原生"],
      ["修改", "在一个 root 中精确编辑。", "搜索、读取、写入、编辑并应用受保护补丁，不暴露其他项目，也不在机器中越界。", "工作区范围"],
      ["并行", "一个任务，一个受管 checkout。", "创建隔离 worktrees，安全带入当前改动；如果目标 checkout 被独立修改，则拒绝覆盖。", "受保护交接"],
      ["协调", "每个真实 child 都有自己的 route。", "当 ChatGPT Work 创建 subagents 时，parent 分配独立项目 route，children 只能报告自己的受限状态；原生 Tasks 显示 Active 与 Done，但不会启动第二个模型后端。", "CHATGPT WORK / ROUTE 隔离"],
      ["验证", "Git 与终端状态持续存在。", "只暂存并提交所选项目，运行受限验证，并让私有路由终端跨工具连接保持运行。", "持久"],
      ["审查", "Diff 应该留在你的电脑。", "分开 staged 与 unstaged 文件，逐 hunk stage 或 revert，并把逐行 review note 带入 web chat 的下一次改动审查。", "原生"],
      ["适配", "项目环境也会随行。", "使用与 Codex 相同的项目环境格式提供 setup、cleanup、actions、skills、plugins 和 MCP 清单，但不运行 Codex。", "可互操作"],
      ["定时", "重复任务始终回到正确项目。", "为 ChatGPT Scheduled 准备稳定运行：重新获得私有 route，并使用干净的受管 worktree，不增加第二个模型后端。", "CHATGPT 原生"],
      ["远程", "同一个 picker，也能连接另一台机器。", "批准命名 OpenSSH host 后，即可在独立路由中使用持久终端、Codex 环境、项目 skills、仓库分析、文件编辑、Bash 与 Git review；远程端不会调用 Codex。", "远程工作区已上线"],
      ["操作", "视觉操作仍然先征求同意。", "从聊天请求一个已签名的原生应用，在 Mac 上批准，查看最新窗口快照，并在本机确认每个敏感的元素级操作。", "COMPUTER USE / 已授权"],
      ["浏览", "和 Web chat 一起审查真实页面。", "批准一个网站 origin 后，可在可见的临时 WebKit tab 中检查与操作语义 DOM，并选择准确元素留下仅该 route 可见的评论。跨 origin 跳转、下载、凭据与敏感操作会被拒绝或要求本机确认。", "WEBKIT / ORIGIN 范围"],
    ],
    safetyKicker: "能力必须有边界",
    safetyTitle: "本地访问应该被认真对待。",
    safetyBody: "这条连接之所以有用，正因为它的限制是明确的。公网路由需要生成的 token，每个文件操作都经过 root 检查，secrets 会被隐藏，危险能力始终需要主动开启。",
    safetyLink: "阅读安全模型",
    guards: [["Token 保护的公网 URL", "未经身份验证的请求无法进入工具面。"], ["工作区 root 强制执行", "路径与 symlink 检查让所有操作始终在范围内。"], ["Secret 感知输出", "凭据和常见 secret 模式会被拦截或隐藏。"], ["受保护写入与终端", "安全默认值一直生效，直到你明确扩大权限。"], ["冲突感知 Worktrees", "交接前会验证两个 checkout，避免覆盖独立改动。"], ["可信环境边界", "项目 setup 与 action 脚本仅在 workspace 写入和 shell 执行均启用时运行。"], ["受限 SSH 项目路由", "只接受具体 alias 与既有 host-key trust；每次调用都会重新检查目标、项目 root、blocked paths、symlink 与策略。"], ["绑定代码签名的应用控制", "Computer Use 权限绑定目标二进制身份；终端、浏览器、ChatGPT、系统设置、安全输入框和 secret 输入都会被拒绝。"], ["临时浏览器隔离", "每个 tab 使用非持久 WebKit profile；重要 DOM 操作绑定最新快照，准确元素评论只保存在内存中并仅对所属聊天 route 可见。"]],
    faqKicker: "直接回答",
    faqTitle: "连接之前。",
    faqs: [["CodexFlow 会运行 Codex CLI 吗？", "不会。ChatGPT 提供模型与对话，CodexFlow 通过 MCP 提供本地项目上下文和工具后端。它不会启动、恢复或伪装成 Codex session。"], ["需要手动注册每个项目吗？", "不需要。运行 codexflow 会自动发现最近项目文件夹和配置 roots。每个对话为自己选择一个项目。"], ["多个聊天可以同时工作吗？", "可以。一个 broker 和 tunnel 能服务多个对话。每个聊天都有独立私有路由，跨工具连接和 broker 重启后仍保持项目绑定。"], ["一个任务可以使用 subagents 吗？", "可以，但需要 ChatGPT Work 提供。ChatGPT 负责 child threads 与模型用量；CodexFlow 为每个真实 child 分配隔离项目 route、收集受限状态与结果，并在原生应用显示 Active / Done。"], ["定时任务能使用本地项目吗？", "可以。ChatGPT Scheduled 负责模型运行与 cadence；CodexFlow 让每次运行重新获得项目、环境和可选的干净 worktree。电脑与 broker 需要保持运行。"], ["这是额度或模型代理吗？", "不是。请求仍使用你自己的 ChatGPT 账号和正常产品限制。CodexFlow 不合并账号、不转售访问，也不绕过额度。"], ["安装需要什么？", "需要 Node.js 20 或更高版本；原生应用需要 macOS 14 或更高版本；并需要 ChatGPT Apps / Developer Mode 访问。启动器会自动安装和打开应用，无需单独设置桌面端。"]],
    finalKicker: "项目已经在你的电脑里",
    finalTitle: "现在，在对话中与它们相遇。",
    finalBody: "安装一次，从任何目录运行；原生应用会打开，每个聊天在开始时选择自己的工作区。",
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
          <div className="hero-foot section-shell" aria-hidden="true"><span>CODEXFLOW / 0.44.0</span><span>LOCAL MACHINE → CHATGPT</span><span>SCROLL TO ENTER</span></div>
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
            <aside className="model-compat"><span>{c.modelNote}</span><div><strong>{c.modelTitle}</strong><p>{c.modelBody}</p></div><i aria-hidden="true">↗</i></aside>
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
            <div className="companion-frame" aria-label={locale === "zh" ? "CodexFlow 原生桌面应用预览" : "CodexFlow native desktop app preview"}>
              <aside className="companion-rail">
                <div className="companion-lockup"><Image src="/brand/flow7-tech-dark.webp" alt="" width={1024} height={1024} /><span><strong>CodexFlow</strong><small>{locale === "zh" ? "原生桌面应用" : "native desktop app"}</small></span></div>
                <div className="companion-ready"><i aria-hidden="true" /><span>{c.companionLive}</span></div>
                <ol>{c.companionViews.map((view, index) => <li className={index === 0 ? "is-active" : ""} key={view}><span>{String(index + 1).padStart(2, "0")}</span>{view}</li>)}</ol>
                <small>ENDORSED BY FLOW7</small>
              </aside>
              <div className="companion-stage">
                <header><span className="companion-window-title"><i className="window-dots" aria-hidden="true"><b /><b /><b /></i>CodexFlow / <strong>{c.companionViews[0]}</strong></span><small>{c.companionLive}</small></header>
                <div className="companion-content">
                  <div className="companion-intro"><small>{locale === "zh" ? "当前运行" : "CURRENT RUN"}</small><h3>{locale === "zh" ? "一切运行，一目了然。" : "Everything in motion."}</h3></div>
                  <dl className="companion-metrics">{c.companionMetrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                  <div className="companion-ledgers">
                    <section aria-label={locale === "zh" ? "聊天路由" : "Chat routing"}>
                      <div className="companion-panel-head"><span>01 / {locale === "zh" ? "实时进度" : "LIVE PROGRESS"}</span><strong>{locale === "zh" ? "进行中的任务" : "Tasks in motion"}</strong></div>
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
          <div className="section-shell"><div className="section-heading"><p className="eyebrow dark-label">{c.surfaceKicker}</p><h2>{c.surfaceTitle}</h2><p>{c.surfaceBody}</p></div><div className="capability-ledger">{c.capabilities.map(([label, title, body, meta], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><p className="micro-label">{label}</p><h3>{title}</h3></div><p>{body}</p><small>{meta}</small></article>)}</div></div>
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
