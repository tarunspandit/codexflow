import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`https://codexflow.example${pathname}`, {
      headers: {
        accept: "text/html",
        host: "codexflow.example",
        "x-forwarded-host": "codexflow.example",
        "x-forwarded-proto": "https",
      },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the complete English launch page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>CodexFlow — One command\. Every project\. Any chat\.<\/title>/i);
  assert.match(html, /One command\./);
  assert.match(html, /Every project\./);
  assert.match(html, /Any chat\./);
  assert.match(html, /npm install -g @tarunspandit\/codexflow/);
  assert.match(html, /One connection\./);
  assert.match(html, /Separate working memory\./);
  assert.match(html, /The native desktop app/);
  assert.match(html, /Everything in motion/);
  assert.match(html, /Supervise routed web tasks, nested Active\/Done agents, plans, blockers/);
  assert.match(html, /live task and subagent progress/i);
  assert.match(html, /Environments/);
  assert.match(html, /Changes/);
  assert.match(html, /Tasks/);
  assert.match(html, /nested Active\/Done agents/i);
  assert.match(html, /Every real child gets its own route/i);
  assert.match(html, /CHATGPT WORK \/ ROUTE ISOLATED/i);
  assert.match(html, /Hosts/);
  assert.match(html, /Computer/);
  assert.match(html, /Browser/);
  assert.match(html, /staged and unstaged files/i);
  assert.match(html, /one hunk at a time/i);
  assert.match(html, /line-anchored review notes/i);
  assert.match(html, /scheduled runs/i);
  assert.match(html, /Recurring work keeps its project/i);
  assert.match(html, /The same picker reaches another machine/);
  assert.match(html, /REMOTE WORKSPACE LIVE/);
  assert.match(html, /isolated terminals, Codex environments, project skills, repository analysis/i);
  assert.match(html, /Visual work still asks first/i);
  assert.match(html, /COMPUTER USE \/ CONSENTED/i);
  assert.match(html, /A clean web profile, not your personal one/i);
  assert.match(html, /WEBKIT \/ ORIGIN SCOPED/i);
  assert.match(html, /CODEXFLOW \/ 0\.43\.0/);
  assert.match(html, /representative native-app preview/i);
  assert.match(html, /Bounded local progress/);
  assert.match(html, /public website cannot see your projects or chats/i);
  assert.match(html, /No Codex CLI execution/);
  assert.match(html, /not affiliated with, endorsed by, or sponsored by OpenAI/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("renders the Chinese edition", async () => {
  const response = await render("/zh");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /本地代码，Web 智能/);
  assert.match(html, /一个命令。/);
  assert.match(html, /所有项目。/);
  assert.match(html, /任意对话。/);
  assert.match(html, /每个聊天/);
  assert.match(html, /原生桌面应用/);
  assert.match(html, /实时任务与 subagent 进度/);
  assert.match(html, /任务/);
  assert.match(html, /Active \/ Done agents/i);
  assert.match(html, /每个真实 child 都有自己的 route/i);
  assert.match(html, /staged 与 unstaged/i);
  assert.match(html, /逐 hunk/i);
  assert.match(html, /逐行 review note/i);
  assert.match(html, /定时任务/);
  assert.match(html, /Hosts/);
  assert.match(html, /Computer Use/);
  assert.match(html, /同一个 picker，也能连接另一台机器/);
  assert.match(html, /远程工作区已上线/);
  assert.match(html, /持久终端、Codex 环境、项目 skills、仓库分析/);
  assert.match(html, /视觉操作仍然先征求同意/);
  assert.match(html, /使用干净的 Web profile/);
  assert.match(html, /CODEXFLOW \/ 0\.43\.0/);
  assert.match(html, /一切运行，一目了然/);
  assert.match(html, /示意预览/);
  assert.match(html, /受限的本地进度/);
  assert.match(html, /不执行 Codex CLI/);
});

test("emits absolute social metadata from the request host", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /property="og:image" content="https:\/\/codexflow\.example\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
