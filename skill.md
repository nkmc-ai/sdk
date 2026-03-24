---
name: nkmc
description: Federated API gateway CLI for AI agents — manage credentials, proxy CLI tools, and peer with other gateways
version: 0.4.0
gateway: nkmc
roles: [agent]
---

nkmc is a CLI tool for interacting with the nkmc gateway network. It lets AI agents securely discover and call APIs, proxy CLI tools with credential injection, and participate in a federated gateway network.

**Install:** `npm install -g @nkmc/cli`

---

## Quick Reference

```bash
# Authenticate
nkmc auth                                    # auth with hosted gateway (nkmc.ai)
nkmc auth --gateway-url http://localhost:9090 # auth with local gateway

# Browse APIs
nkmc ls /                                    # list all services
nkmc grep "weather" /                        # search services
nkmc cat /api.github.com/skill.md            # read API spec

# Call APIs (gateway injects credentials)
nkmc cat /api.github.com/repos/nkmc-ai/gateway
nkmc write /discord.com/channels/123/messages '{"content":"hello"}'
nkmc rm /api.cloudflare.com/zones/z1/dns_records/rec_1

# Proxy CLI tools (gateway injects env vars)
nkmc run gh repo list
nkmc run stripe customers list --limit 10
nkmc run openai api chat.completions.create -m gpt-4 -p "hello"

# Manage credentials (AES-GCM encrypted in gateway vault)
nkmc keys set github.com --token ghp_xxx
nkmc keys set api.openai.com --token sk-xxx
nkmc keys list
nkmc keys remove github.com

# Run your own gateway
nkmc gateway start                           # local, port 9090
nkmc gateway start --tunnel                  # with public URL via CF Tunnel
nkmc gateway start --daemon                  # background
nkmc gateway stop
nkmc gateway status

# Register a service (OpenAPI auto-discovery)
nkmc register --url http://localhost:3000
nkmc register --url http://localhost:3000 --spec-url http://localhost:3000/openapi.json

# Federation — peer with other gateways
nkmc peers discover                          # find online gateways
nkmc peers discover --domain api.openai.com  # find who has OpenAI
nkmc peers add --id bob --name "Bob" --url https://xyz.tunnel.nkmc.ai --secret xxx
nkmc peers list
nkmc peers remove bob

# Lending rules — control what you share
nkmc rules set api.openai.com --allow --pricing free
nkmc rules set api.stripe.com --allow --pricing per-request --amount 0.01
nkmc rules set github.com --deny
nkmc rules list
nkmc rules remove api.openai.com

# Domain verification
nkmc claim api.example.com                   # get DNS challenge
nkmc claim api.example.com --verify          # verify and get publish token
```

---

## Commands

### nkmc auth

Authenticate with a gateway and save JWT token to `~/.nkmc/credentials.json`.

```bash
nkmc auth                                     # hosted gateway (https://nkmc.ai)
nkmc auth --gateway-url http://localhost:9090  # local gateway
```

Token is valid for 24h. All subsequent commands use the saved token automatically.

### nkmc ls \<path\>

List services or directory contents.

```bash
nkmc ls /                        # all services on the network
nkmc ls /api.github.com/         # contents of a specific service
```

### nkmc cat \<path\>

Read data from a virtual path.

```bash
nkmc cat /api.github.com/skill.md
nkmc cat /api.github.com/repos/nkmc-ai/gateway
nkmc cat /rpc.ankr.com/blocks/21000000.json
```

### nkmc grep \<pattern\> \<path\>

Search services or endpoints.

```bash
nkmc grep "weather" /                # search across all services
nkmc grep "alerts" /api.weather.gov/ # search within a service
```

### nkmc write \<path\> \<data\>

Send data to a POST endpoint.

```bash
nkmc write /api.cloudflare.com/zones/z1/dns_records '{"type":"A","name":"app","content":"1.2.3.4"}'
```

### nkmc rm \<path\>

Delete a resource.

```bash
nkmc rm /api.cloudflare.com/zones/z1/dns_records/rec_1abc
```

### nkmc pipe \<expression\>

Pipe data between two paths.

```bash
nkmc pipe 'cat /api.weather.gov/alerts/active | write /discord.com/channels/123/messages'
```

### nkmc run \<tool\> \[args...\]

Proxy a CLI tool through the gateway. The gateway looks up credentials for the tool, injects them as environment variables, executes the tool, and returns output.

```bash
nkmc run gh repo list
nkmc run stripe customers list --limit 5
nkmc run aws s3 ls
```

Built-in tools: `gh` (GitHub), `stripe`, `openai`, `anthropic`, `aws`.

### nkmc keys set \<domain\>

Store an API key in the gateway vault (AES-GCM encrypted).

```bash
nkmc keys set github.com --token ghp_xxx
nkmc keys set api.openai.com --token sk-xxx
nkmc keys set api.stripe.com --token sk_test_xxx
```

### nkmc keys list / remove

```bash
nkmc keys list                   # list all stored keys
nkmc keys remove github.com      # remove a key
```

### nkmc gateway start / stop / status

Run a local gateway instance.

```bash
nkmc gateway start                # foreground, port 9090
nkmc gateway start --port 8080    # custom port
nkmc gateway start --tunnel       # with Cloudflare Tunnel (public URL)
nkmc gateway start --daemon       # background mode
nkmc gateway stop                 # stop background gateway
nkmc gateway status               # check if running + tunnel URL
```

### nkmc register

Register a service with the gateway.

```bash
# Auto-discover from running service (probes OpenAPI well-known paths)
nkmc register --url http://localhost:3000

# With explicit OpenAPI spec URL
nkmc register --url http://localhost:3000 --spec-url http://localhost:3000/docs/openapi.json

# From skill.md file
nkmc register --domain api.example.com --dir ./my-project
```

### nkmc peers

Manage peer gateways for federation.

```bash
nkmc peers discover                           # find online gateways
nkmc peers discover --domain api.openai.com   # filter by domain
nkmc peers add --id bob --name "Bob" --url https://xyz.tunnel.nkmc.ai --secret shared-key
nkmc peers list
nkmc peers remove bob
```

### nkmc rules

Manage credential lending rules.

```bash
nkmc rules set api.openai.com --allow --pricing free
nkmc rules set api.stripe.com --allow --peers peer-bob --pricing per-request --amount 0.01
nkmc rules set github.com --deny
nkmc rules list
nkmc rules remove api.openai.com
```

### nkmc claim \<domain\>

Claim domain ownership via DNS TXT verification.

```bash
nkmc claim api.example.com          # get challenge
# Add TXT record: _nkmc.api.example.com → nkmc-verify=xxx
nkmc claim api.example.com --verify # verify and get publish token
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NKMC_GATEWAY_URL` | Gateway URL (default: `https://nkmc.ai`) |
| `NKMC_TOKEN` | Agent JWT token (prefer `nkmc auth`) |
| `NKMC_ADMIN_TOKEN` | Admin token for gateway management |
| `NKMC_GATEWAY_NAME` | Display name for tunnel discovery |
| `NKMC_HOME` | Config directory (default: `~/.nkmc`) |

---

## Links

- GitHub: [nkmc-ai/gateway](https://github.com/nkmc-ai/gateway) · [nkmc-ai/sdk](https://github.com/nkmc-ai/sdk)
- npm: [@nkmc/cli](https://www.npmjs.com/package/@nkmc/cli) · [@nkmc/core](https://www.npmjs.com/package/@nkmc/core) · [@nkmc/gateway](https://www.npmjs.com/package/@nkmc/gateway) · [@nkmc/server](https://www.npmjs.com/package/@nkmc/server)
