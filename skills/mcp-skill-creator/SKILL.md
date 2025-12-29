---
name: mcp-skill-creator
description: Create skills that wrap MCP (Model Context Protocol) servers for use with mcp-skill-client. Use when user wants to create a new MCP-based skill, wrap an existing MCP server as a skill, or generate SKILL.md with tool documentation from an MCP server.
---

# MCP Skill Creator

Create skills that wrap MCP servers for browser automation, database access, API integrations, and more. Generated skills use `mcp-skill-client` to maintain persistent MCP sessions.

## Quick Start

1. Start daemon to fetch tools: `npx github:runoshun/mcp-skill-client --config config.json start`
2. List available tools: `npx github:runoshun/mcp-skill-client --config config.json tools`
3. Create skill folder with SKILL.md and config.json

## Skill Structure

```
skill-name/
├── SKILL.md        # Skill instructions with tool documentation
└── config.json     # MCP server configuration
```

## Creating a Skill

### Step 1: Create config.json

```json
{
  "name": "skill-name",
  "transport": "stdio",
  "command": "npx",
  "args": ["@org/mcp-package@version", "--option1", "--option2"],
  "env": {}
}
```

**Transport options:**
- `stdio`: Spawns MCP server as subprocess (most common)
- `http`: Connects to running MCP server at URL

### Step 2: Fetch Tool List

```bash
# Start daemon temporarily
npx github:runoshun/mcp-skill-client --config config.json start

# Get tool list (copy this output for SKILL.md)
npx github:runoshun/mcp-skill-client --config config.json tools

# Stop daemon
npx github:runoshun/mcp-skill-client --config config.json stop
```

### Step 3: Write SKILL.md

Use this template:

```markdown
---
name: skill-name
description: [What the skill does and when to use it]
---

# Skill Name

[Brief description of what this skill enables]

## Setup

Start the MCP daemon:
\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json start
\`\`\`

## Available Tools

[Document each tool from the tools list]

### tool_name
[Description from MCP server]

**Parameters:**
- `param1` (required): Description
- `param2` (optional): Description

**Example:**
\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json call tool_name param1=value
\`\`\`

## Workflow

1. Start daemon (once per session)
2. Call tools as needed
3. Stop daemon when done

## Cleanup

\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json stop
\`\`\`
```

## Example: Playwright MCP Skill

### config.json

```json
{
  "name": "playwright-mcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["@anthropic/mcp-playwright@latest", "--headless", "--browser", "chromium"]
}
```

### SKILL.md (excerpt)

```markdown
---
name: playwright-mcp
description: Browser automation via Playwright MCP server. Navigate pages, click elements, fill forms, take screenshots. Use for web testing, scraping, or any browser automation task.
---

# Playwright MCP

Browser automation with persistent session via MCP.

## Setup

\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json start
\`\`\`

## Tools

### browser_navigate
Navigate to a URL.

\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json call browser_navigate url=https://example.com
\`\`\`

### browser_click
Click an element by reference or text.

\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json call browser_click element="Submit" ref=e12
\`\`\`

### browser_screenshot
Take a screenshot.

\`\`\`bash
npx github:runoshun/mcp-skill-client --config $SKILL_DIR/config.json call browser_screenshot
\`\`\`
```

## Tool Documentation Format

When documenting tools in SKILL.md:

1. **Tool name as heading** - Use `### tool_name`
2. **Brief description** - One line explaining what it does
3. **Parameters** - List with types and required/optional
4. **Example** - Show actual command with realistic values

## Templates

Copy templates from `assets/` directory:
- `assets/config.json` - MCP server configuration template
- `assets/SKILL.md.template` - SKILL.md template with placeholders

## Tips

- **$SKILL_DIR**: Use this placeholder for skill directory path
- **Session persistence**: Daemon maintains browser/connection state between calls
- **Error handling**: Check daemon status if tools fail
- **Multiple skills**: Each skill should use different port (`--port` option)
