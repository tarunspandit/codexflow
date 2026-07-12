# CodexFlow Domain Setup

This guide explains how to use a Namecheap domain, Cloudflare, or ngrok so CodexFlow can keep a stable ChatGPT connector URL.

There are two different products hiding behind the phrase "one URL":

- Personal stable URL: one developer runs CodexFlow locally and keeps a stable URL such as `https://mcp.example.space/mcp`.
- Hosted relay for all users: every user gets a stable CodexFlow URL without managing Cloudflare. This requires a hosted service that routes each ChatGPT request to the correct user's local agent.

The personal stable URL works now. The hosted relay is the product architecture to build before public launch.

## What A Domain Can And Cannot Do

A DNS hostname points traffic to one Cloudflare tunnel, load balancer, or hosted service. It cannot automatically discover every user's laptop.

For public users, one shared domain needs one of these designs:

- Per-user tunnel hostnames, such as `alice.mcp.example.space` and `bob.mcp.example.space`, each routed to that user's tunnel.
- A hosted relay at `mcp.example.space` where each local CodexFlow agent opens an outbound connection and authenticates. ChatGPT calls the relay URL, and the relay forwards each request to the right connected local agent.

The hosted relay is the clean end-user experience:

```text
User terminal
  CodexFlow --root .
  opens outbound session to your relay

ChatGPT connector
  https://mcp.example.space/<workspace-id>/mcp

Relay
  authenticates request
  forwards MCP traffic to the correct user's local CodexFlow agent
```

That is how you make the setup feel like one URL for everyone.

## Recommended Domain Layout

Use subdomains instead of the apex domain:

```text
codexflow.example.space       marketing/docs site
app.example.space            future dashboard/login
mcp.example.space            hosted relay entrypoint
local.example.space          optional private dogfood tunnel
```

For your current dogfood setup, use:

```text
local.example.space
```

For the future public product, use:

```text
mcp.example.space
```

## One-Time Namecheap And Cloudflare Setup

1. Add your apex domain to Cloudflare.

   In Cloudflare Dashboard, go to Domains, choose "Onboard a domain", enter your domain such as `example.space`, choose a plan, and review imported DNS records.

2. Change Namecheap nameservers.

   In Namecheap, open Domain List, choose Manage for the domain, set Nameservers to Custom nameservers, enter the two Cloudflare nameservers, and save.

3. Wait for activation.

   Namecheap says nameserver propagation can take up to 24-48 hours in rare cases. Cloudflare will show the domain as active once the nameservers are picked up.

4. Preserve email records.

   If the domain receives email, make sure MX, SPF, DKIM, and DMARC records exist in Cloudflare before relying on the domain.

## Personal Stable Tunnel

Install or bootstrap `cloudflared`:

```bash
codexflow install-cloudflared
```

That installs the official Cloudflare binary into `~/.codexflow/bin` on supported macOS, Windows, and Linux machines. You can also install `cloudflared` manually and keep it on PATH.

Authenticate:

```bash
~/.codexflow/bin/cloudflared tunnel login
```

Create a named tunnel:

```bash
~/.codexflow/bin/cloudflared tunnel create codexflow-local
~/.codexflow/bin/cloudflared tunnel route dns codexflow-local local.example.space
```

Start CodexFlow with that stable hostname:

```bash
codexflow stable \
  --root /absolute/path/to/your/repo \
  --hostname local.example.space \
  --tunnel-name codexflow-local \
  --token replace-with-a-long-stable-token \
  --bash safe
```

Add this once in ChatGPT Developer Mode:

```text
Name: CodexFlow
Connection: Server URL
Server URL: https://local.example.space/mcp?codexflow_token=replace-with-a-long-stable-token
Authentication: None / No Authentication
```

After that, restart only the terminal command. You do not need to edit the ChatGPT connector unless you change the hostname or token.

## Dashboard-Managed Tunnel Token

If you create the tunnel in the Cloudflare dashboard, save the connector token locally:

```bash
mkdir -p ~/.codexflow
chmod 700 ~/.codexflow
$EDITOR ~/.codexflow/cloudflare-tunnel-token
chmod 600 ~/.codexflow/cloudflare-tunnel-token
```

Then run:

```bash
codexflow stable \
  --root /absolute/path/to/your/repo \
  --hostname local.example.space \
  --cloudflare-token-file ~/.codexflow/cloudflare-tunnel-token \
  --token replace-with-a-long-stable-token \
  --bash safe
```

Do not confuse these two tokens:

```text
Cloudflare tunnel token  lets cloudflared connect your machine to Cloudflare.
codexflow MCP token       protects the /mcp endpoint that ChatGPT calls.
```

## Ngrok Free Dev Domain

Ngrok is the simpler personal stable URL for most users. A free ngrok account includes a dev domain, which can be saved once in CodexFlow and reused every time the local server restarts.

One-time setup:

```bash
brew install ngrok
ngrok config add-authtoken <your-ngrok-token>
```

Find your assigned dev domain in the ngrok dashboard under Universal Gateway -> Domains, for example:

```text
your-domain.ngrok-free.dev
```

Daily startup:

```bash
codexflow ngrok \
  --root /absolute/path/to/your/repo \
  --hostname your-domain.ngrok-free.dev \
  --token replace-with-a-long-stable-token \
  --bash safe
```

Add this once in ChatGPT Developer Mode:

```text
Name: CodexFlow
Connection: Server URL
Server URL: https://your-domain.ngrok-free.dev/mcp?codexflow_token=replace-with-a-long-stable-token
Authentication: None / No Authentication
```

CodexFlows the local MCP server, runs `ngrok http http://127.0.0.1:8787 --url https://your-domain.ngrok-free.dev`, waits for `/healthz`, copies the Server URL, and keeps both processes alive until you quit.

## Product Plan For All Users

For open-source users, support three modes:

```text
1. Local-only stdio/HTTP
   No public URL. Best for clients that can launch local MCP commands.

2. Bring-your-own tunnel
   User owns Cloudflare/ngrok/domain. Good for power users and contributors.

3. CodexFlow hosted relay
   Best public UX. User runs one local command and gets a stable connector URL from your service.
```

The hosted relay needs:

- User auth and device registration.
- Per-device or per-workspace MCP URLs.
- Local agent outbound WebSocket or HTTP/2 session to the relay.
- Per-session CodexFlow token rotation.
- Audit log of tool names, durations, and file paths, without source contents by default.
- Strict write modes: `workspace` by default for agent mode, `handoff` when the user chooses planning-only mode.
- Workspace root allowlist enforced locally, not only at the relay.
- Revocation from the dashboard.

## Latency And Cost

For your own named tunnel, latency should be similar to the current quick tunnel. The domain itself does not add meaningful latency; traffic still goes through Cloudflare Tunnel.

For the hosted relay, there is one extra hop:

```text
ChatGPT -> Cloudflare/relay -> user's local CodexFlow agent
```

That is usually fine for planning and file operations. The bigger speed win is reducing tool calls and response payloads:

- Start with `open_current_workspace` and `include_tree=false`.
- Use targeted `read`, `search`, and `codex_context`.
- Show widget cards only for high-signal write/edit/diff results.
- Keep `server_config`, inventory, tree, read, and search compact.

For cost, the domain renewal is separate. Cloudflare DNS and basic tunnel usage can be enough for dogfooding. A public relay will eventually cost real hosting/traffic/observability money, even if it starts small on Cloudflare Workers, Durable Objects, or a small server.

## Sources

- Cloudflare domain onboarding: https://developers.cloudflare.com/fundamentals/manage-domains/add-site/
- Namecheap Cloudflare nameserver setup: https://www.namecheap.com/support/knowledgebase/article.aspx/9607/2210/how-to-set-up-dns-records-for-your-domain-in-a-cloudflare-account/
- Cloudflare locally-managed tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/
- Cloudflare Tunnel overview: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
