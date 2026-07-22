# CodexFlow 中文 FAQ

## 我应该用什么 ChatGPT 账号？

使用能访问 Apps / Developer Mode 的 ChatGPT 账号。OpenAI 当前文档列出的 web 端 Developer Mode 账号范围包括 Pro、Plus、Business、Enterprise 和 Education。

当前测试显示，Free / Go 账号不暴露 CodexFlow 需要的 App 创建流程。

codexflow 不解锁 Developer Mode，不解锁模型，不绕过账号限制，也不提供账号访问。它只连接你自己的 ChatGPT App 界面和你自己的本地仓库。

账号权限与模型能力是两回事。Pro 订阅可以拥有 Apps / Developer Mode，但 ChatGPT 的 **Pro 模型变体不会开放 Apps**。使用 Extra High 或其他非 Pro 模型运行 CodexFlow。如果回复里没有 App，请切换模型，不要重启 broker。

## 为什么新聊天里看不到 CodexFlow？

CodexFlow 并没有“一次只能用于一个聊天”的限制。ChatGPT 在 `+` 菜单中最先显示的是排序后的部分推荐项，不是完整插件列表。请在新聊天中使用受支持的非 Pro 模型，选择 `+` → More，然后搜索 `CodexFlow`。

如果搜索结果同时出现 `CodexFlow` 和旧的 `CodexFlow Local`，请保留连接到当前 Server URL 的条目，并在 Settings → Plugins 中删除过期重复项。之后多个聊天可以同时共享同一个 app 和 tunnel，而每个聊天选择的项目会由独立私有路由隔离。

## 项目选择器无法显示时怎么办？

直接回复准确的项目名称。选择器只是一个小型可选界面，项目发现与路由并不依赖它。CodexFlow 同时返回文本项目列表，ChatGPT 可以直接按名称或 project ID 调用 `select_project`。

原生应用只会在聊天选定项目后显示它。未绑定的 discovery、metadata、picker 和组件获取 transport 都会隐藏；属于同一私有路由的多个 transport 会合并成一条聊天记录。

## 推荐安装方式是什么？

注意：这个 FAQ 跟随 GitHub `main`。假设某个 `main` 功能已经进入 `codexflow@latest` 前，请先看 npm badge/version。

全局安装一次：

```bash
npm install -g @tarunspandit/codexflow
```

然后从任何目录运行唯一命令：

```bash
codexflow
```

CodexFlow 会自动发现本机 Codex 使用过的项目，启动 broker 和 tunnel，并在 macOS 14 或更新版本安装、打开原生桌面应用。

`npx codexflow@latest` 仍然可用，但普通用户更容易理解全局安装。

## 原生桌面应用是什么？

它是 CodexFlow 的主要本地控制界面。在 macOS 14 或更新版本，第一次运行 `codexflow` 会自动安装并打开它。即使 broker 尚未运行，也可以使用：

```bash
codexflow app
```

它展示已发现项目、活跃与最近关闭的聊天路由、不包含内容的工具活动、连接健康、下次启动设置，以及当前进程真正生效的策略。它可以选择 workspace，启动、停止或重启本地 broker，并在明确操作时复制私有 Server URL。它没有模型输入框，不调用 Codex CLI，也不能偷偷把现有 ChatGPT 对话切换到另一个项目；项目选择仍由该对话里的 CodexFlow picker 或准确项目名称回复完成。

旧的 token 保护浏览器页面只保留为紧急 fallback，用于打开桌面应用和查看少量诊断，不再复制桌面产品。

活动 ledger 只存在于进程内存中并有上限。它保存项目、工具名称、结果、耗时和不可操作的显示指纹，不保存 prompts、arguments、文件内容、命令输出、tokens 或可用的 MCP transport identifiers。

## ChatGPT 里要打开什么设置？

在 ChatGPT 中打开：

```text
Settings
-> Security and login
-> Developer mode: on
-> Enforce CSP in developer mode: on

Settings
-> Plugins
-> Create
```

创建 Plugin 时填写：

```text
Name: CodexFlow
Description: Local workspace bridge for ChatGPT coding
Connection: Server URL
Server URL: 粘贴 CodexFlow 复制的 URL
Authentication: No Authentication / None
```

复制的 Server URL 已经包含私有 CodexFlow token。

## CSP 要保持开启吗？

要保持开启。

codexflow 的小组件按 CSP 开启的路径构建。它不需要远程脚本、外部字体、iframe、第三方图片或任意外部请求。

## CodexFlow 会绕过速率限制吗？

不会。

codexflow 不绕过、不提升、不合并、不转售、不修改 ChatGPT、Codex、OpenAI 或第三方模型限制。所有请求仍然通过你自己的 ChatGPT 会话，并受该账号当前限制约束。

它的价值在于 ChatGPT 和 Codex 是不同产品界面。某个工作流暂时不可用时，如果另一个你本来就有权限的界面仍可用，CodexFlow 可以让它继续操作同一个本地仓库。

## CodexFlow 可以使用 GPT-5.5 吗？

前提是你的 ChatGPT 账号已经提供该模型，并且所选模型支持 Apps。ChatGPT 的 Pro 模型变体不会开放 Apps；请使用 Extra High 或其他非 Pro 模型运行 CodexFlow。

codexflow 不提供、不代理、不转售、也不解锁模型。它只给兼容的 ChatGPT 会话提供本地仓库工具。

如果某个模型不能直接调用工具，用上下文包回退：

```bash
codexflow pro-bundle --root /path/to/repo --copy
```

然后把生成的 `.ai-bridge/pro-context.md` 粘贴给该模型，让它做规划，再用本地执行器执行。

## 为什么 Pro 账号也可能连不上某个模型？

账号权限和模型工具能力是两回事。

Pro 订阅可以暴露 Apps / Developer Mode，但 Pro 模型变体本身不会调用连接器或 MCP 工具。请切换到 Extra High 或其他非 Pro 模型；如果必须留在不支持工具的模型上，再用 `codexflow pro-bundle --copy` 导出上下文。

## ChatGPT 能通过 CodexFlow 看到什么？

ChatGPT 能看到工具显式暴露的工作区内容：

- `AGENTS.md`
- `.ai-bridge` 计划、状态、执行记录
- git status
- git diff
- 文件树和搜索结果
- 你让它读取的源码文件

它不能读取 Codex 的隐藏运行时记忆，也不能读取工作区外的文件，除非你明确允许额外 root。

## ChatGPT 可以编辑什么？

Normal coding 模式下，ChatGPT 可以在配置的工作区内写入和精确编辑文件。

默认会阻止：

- `.env`
- 私钥
- `.git`
- `node_modules`
- 生成目录和缓存目录
- symlink 逃逸
- 工作区外路径

如果你只想让 ChatGPT 规划，不想让它直接改源码，用 handoff 模式。

## CodexFlow 能把 bash 绑定到某个会话 id 吗？

codexflow 不能附加到、读取或复用某一个 Codex App 聊天会话或终端会话。

MCP 的 `bash` 工具是在你启动的 CodexFlow 本地服务器进程里，针对配置的 workspace root 执行。MCP session id 只是 ChatGPT 和 CodexFlow HTTP 服务器之间的传输状态，不是 Codex 会话 id。

但 CodexFlow 可以要求 bash 调用带上匹配的本地 session 标签：

```bash
codexflow --bash-session main --require-bash-session
```

之后 `bash` 调用必须包含 `session_id: "main"`。这能避免误触发到错误的 CodexFlow 终端，但不是远程控制某个已有的 Codex App 聊天。

如果你显式开启，CodexFlow 可以列出本地 Codex session id 和标题：

```bash
codexflow --tool-mode full --codex-sessions metadata
```

它会读取 `~/.codex/sessions` 和 `~/.codex/archived_sessions` 下的本地 Codex JSONL 历史，返回 metadata 和 `codex resume <session-id>` 命令。只有需要有限长度 transcript 读取时才使用 `--codex-sessions read`。它不会附加到正在运行的 Codex App 聊天。

如果你正在 Codex 里工作，不希望 ChatGPT 触发 shell 命令，可以关闭 bash：

```bash
codexflow --no-bash
```

如果只想让 ChatGPT 写计划，由 Codex 或其他本地 agent 执行：

```bash
codexflow --mode handoff --no-bash
```

## 选择哪种 tunnel？

按这个规则选：

```text
快速 demo：          Cloudflare quick tunnel
推荐稳定 URL：       ngrok free dev domain
自定义域名：          Cloudflare named tunnel
Tailnet 用户：        Tailscale Funnel
无公网 URL：          local-only，只适合能访问 localhost 的 MCP 客户端
```

Cloudflare quick tunnel 每次重启 URL 都变。把 quick URL 填到 ChatGPT 后，每次重启都要改 ChatGPT App 的 Server URL。

大多数用户建议用 ngrok free dev domain。创建免费 ngrok 账号，在 Universal Gateway -> Domains 找到分配给你的 dev domain，并在 `codexflow` 里保存。

如果你有自己的域名，用 Cloudflare named tunnel，把 DNS 路由到例如 `codexflow.example.com` 的主机名。

## ChatGPT 创建 connector 时显示 “Something went wrong” 怎么办？

通常是 ChatGPT 无法访问公网 MCP URL。生成 `trycloudflare.com` URL 不代表 `cloudflared` 一直连通。

运行连接测试：

```bash
codexflow connection-test --root /path/to/repo
```

这个模式保留 `read`、`tree`、`search` 和 `load_skill`，关闭文件写入、bash
和 tool cards，并记录请求是否到达本地 MCP endpoint。在 ChatGPT 的
`Settings -> Plugins` 创建 development plugin，粘贴完整 Server URL，
Authentication 选择 `No Authentication`。

- 没有 `POST /mcp received`：请求没有到达 CodexFlow，检查 ChatGPT Plugins 页面和 tunnel。
- `POST /mcp -> 401`：请粘贴包含 `codexflow_token` 的完整 URL。
- `POST /mcp -> 2xx`：ChatGPT 已到达 CodexFlow，MCP endpoint 也已响应。

测试期间保持 CodexFlow 运行。Cloudflare quick tunnel 每次重启都会更换 URL。
如果 Cloudflare 返回 `530` / `Error 1033`，检查运行 `cloudflared` 的机器上的
DNS 或代理客户端 DNS 设置。

ChatGPT 现在在 Plugins 中管理 development app。浏览器错误
`Failed to execute 'removeChild' on 'Node'` 发生在 ChatGPT 页面中，早于任何
codexflow MCP 请求。请在 Plugins 页面删除或重建旧条目，再使用当前 URL 重试；
codexflow 无法修复浏览器端的旧条目。

## 能每天使用同一个 ChatGPT App URL 吗？

可以，前提是使用稳定 hostname。

推荐简单路径：

```bash
codexflow
# 选择 ngrok
# 输入你的 ngrok free dev domain
```

之后：

```bash
codexflow
```

同一个 hostname 和 CodexFlow token 会被当前工作区复用。

## quick mode 为什么每次都要改 URL？

Cloudflare quick tunnel 是一次性的临时地址。每次重新启动 tunnel，Cloudflare 会分配一个新的 `trycloudflare.com` URL。

如果你不想改 ChatGPT 设置，用 ngrok free dev domain 或 Cloudflare named tunnel。

## 同时处理两个仓库怎么办？

只运行一个 CodexFlow。打开两个 ChatGPT 对话，在各自的项目选择器中选择不同仓库；它们共享同一个 broker/tunnel，但项目绑定彼此独立。

## 最新文档在哪里？

请使用 [CodexFlow 网站](https://tarunspandit.github.io/codexflow/zh.html)、[GitHub 仓库](https://github.com/tarunspandit/codexflow) 或 npm 包内附带的文档。

## CodexFlow 是否违反服务条款？

codexflow 使用 ChatGPT 的官方 Developer Mode / MCP App 接入路径，让你自己的 ChatGPT 会话连接到你自己的本地工具。

它不绕过限制，不抓取隐藏接口，不共享账号，不转售模型，不伪造请求来源，也不把第三方模型包装成别的模型。

用户仍然需要遵守 ChatGPT、Codex、OpenAI 和任何第三方服务的条款。

## CodexFlow 生产环境安全吗？

codexflow 是本地开发桥，不是操作系统级沙箱。

只在你信任的仓库里使用。公网 tunnel 保持 token auth 开启。保持 safe bash，除非你明确知道为什么需要 full bash。公网暴露前先读 [SECURITY.md](SECURITY.md)。

## 保存的设置在哪里？

工作区配置保存在：

```text
~/.codexflow/profiles/
```

管理命令：

```bash
codexflow settings
codexflow settings list
codexflow settings delete --yes
```

显示设置时，保存的 token 会被打码。

## CodexFlow 能帮助 ChatGPT 维持上下文吗？

可以帮助，但方式是显式文件和上下文包，不是隐藏记忆。

推荐使用：

- `AGENTS.md` 写项目规则。
- `.ai-bridge/decisions.md` 写关键决策。
- `.ai-bridge/current-plan.md` 写当前计划。
- `.ai-bridge/agent-status.md` 写本地执行结果。
- `codexflow pro-bundle --copy` 给不能调用工具的模型生成上下文包。

这样 ChatGPT 断线、换模型或换会话后，仍然可以通过文件恢复上下文。
