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
  assert.match(html, /Start and stop the broker/);
  assert.match(html, /shared local environments/i);
  assert.match(html, /Environments/);
  assert.match(html, /scheduled project runs/i);
  assert.match(html, /Recurring work keeps its project/i);
  assert.match(html, /CODEXFLOW \/ 0\.33\.0/);
  assert.match(html, /representative native-app preview/i);
  assert.match(html, /Content-free telemetry/);
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
  assert.match(html, /共享本地环境/);
  assert.match(html, /定时项目任务/);
  assert.match(html, /CODEXFLOW \/ 0\.33\.0/);
  assert.match(html, /一切运行，一目了然/);
  assert.match(html, /示意预览/);
  assert.match(html, /不包含内容的遥测/);
  assert.match(html, /不执行 Codex CLI/);
});

test("emits absolute social metadata from the request host", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /property="og:image" content="https:\/\/codexflow\.example\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
