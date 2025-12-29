# MCP Skill Client

Universal MCP client for skill-based automation. Maintains persistent MCP sessions via daemon mode.

## Installation

```bash
# Via npx (npm)
npx mcp-skill-client --config ./config.json start

# Via npx from GitHub
npx github:username/mcp-skill-client --config ./config.json start
```

## Usage

```bash
# Start daemon
mcp-skill-client --config ./config.json start

# List available tools
mcp-skill-client --config ./config.json tools

# Call a tool
mcp-skill-client --config ./config.json call <tool_name> [key=value ...]

# Check status
mcp-skill-client --config ./config.json status

# Stop daemon
mcp-skill-client --config ./config.json stop
```

## Config File Format

### stdio transport (spawn MCP server as subprocess)

```json
{
  "name": "my-mcp-server",
  "transport": "stdio",
  "command": "npx",
  "args": ["@org/mcp-server@1.0.0", "--some-flag"],
  "env": {
    "API_KEY": "xxx"
  }
}
```

### http transport (connect to running MCP server)

```json
{
  "name": "my-mcp-server",
  "transport": "http",
  "url": "http://localhost:8931/mcp"
}
```

## Examples

### Playwright MCP

config.json:
```json
{
  "name": "playwright-mcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["@playwright/mcp@0.0.53", "--headless", "--browser", "chromium", "--no-sandbox"]
}
```

Usage:
```bash
mcp-skill-client --config ./config.json start
mcp-skill-client --config ./config.json call browser_navigate url=https://example.com
mcp-skill-client --config ./config.json call browser_click ref=e6 element="Learn more"
mcp-skill-client --config ./config.json call browser_snapshot
mcp-skill-client --config ./config.json stop
```

### GitHub MCP

config.json:
```json
{
  "name": "github-mcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-github@0.6.2"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx"
  }
}
```

## How It Works

1. `start` - Spawns daemon process that:
   - Connects to MCP server (stdio or http)
   - Maintains persistent session
   - Exposes local HTTP API for commands

2. `call` - Sends tool call via HTTP to daemon

3. `stop` - Terminates daemon and MCP server

Session state (PID, port) stored in `.mcp-client/` next to config file.

## License

MIT
