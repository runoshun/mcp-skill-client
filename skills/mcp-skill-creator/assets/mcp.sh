#!/bin/bash
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec npx github:runoshun/mcp-skill-client --config "$SKILL_DIR/config.json" "$@"
