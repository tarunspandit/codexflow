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
  assert.match(html, /<title>CodexFlow — Local code\. Web intelligence\.<\/title>/i);
  assert.match(html, /One command\./);
  assert.match(html, /Every project\./);
  assert.match(html, /Any chat\./);
  assert.match(html, /npm install -g @tarunspandit\/codexflow/);
  assert.match(html, /One tunnel\. Separate worlds\./);
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
  assert.match(html, /任意聊天。/);
  assert.match(html, /不执行 Codex CLI/);
});

test("emits absolute social metadata from the request host", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /property="og:image" content="https:\/\/codexflow\.example\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
