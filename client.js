#!/usr/bin/env node
/**
 * Universal MCP Skill Client
 * 
 * A daemon-based client that maintains MCP session for any MCP server.
 * Supports both stdio and HTTP transports.
 * 
 * Usage:
 *   mcp-skill-client --config config.json start     # Start daemon
 *   mcp-skill-client --config config.json call <tool> [args...]  # Call tool
 *   mcp-skill-client --config config.json stop      # Stop daemon
 *   mcp-skill-client --config config.json status    # Check status
 *   mcp-skill-client --config config.json tools     # List available tools
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line
const args = process.argv.slice(2);

function parseArgs(args) {
  const result = {
    config: null,
    command: null,
    toolArgs: [],
    daemonPort: 8940,
    format: 'auto',
    outputDir: null
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      result.config = args[i + 1];
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      result.daemonPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--format' && args[i + 1]) {
      result.format = args[i + 1];
      i++;
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      result.outputDir = args[i + 1];
      i++;
    } else if (!result.command) {
      result.command = args[i];
    } else {
      result.toolArgs.push(args[i]);
    }
  }
  
  return result;
}

function loadConfig(configPath) {
  if (!configPath) {
    console.error('Error: --config is required');
    process.exit(1);
  }
  
  const absPath = path.resolve(configPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: Config file not found: ${absPath}`);
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  config._configDir = path.dirname(absPath);
  config._stateDir = path.join(config._configDir, '.mcp-client');
  config._outputDir = path.join(config._stateDir, 'output');
  
  // Ensure state directory exists
  if (!fs.existsSync(config._stateDir)) {
    fs.mkdirSync(config._stateDir, { recursive: true });
  }
  
  return config;
}

function printUsage() {
  console.log(`Universal MCP Skill Client

Usage:
  mcp-skill-client --config <config.json> <command> [options]

Commands:
  start [--port PORT]    Start daemon (default port: 8940)
  stop                   Stop daemon
  status                 Check daemon status
  tools                  List available tools
  call <tool> [args...]  Call MCP tool

Options:
  --format <auto|json>   Output format (default: auto)
  --output-dir <dir>     Directory for saving images/audio

Config file format (config.json):
  {
    "name": "my-mcp-server",
    "transport": "stdio",           // or "http"
    "command": "npx",               // for stdio
    "args": ["@org/mcp-server@1.0.0"],
    "env": {},                      // optional environment variables
    "url": "http://localhost:8931/mcp"  // for http transport
  }

Examples:
  mcp-skill-client --config ./config.json start
  mcp-skill-client --config ./config.json call browser_navigate url=https://example.com
  mcp-skill-client --config ./config.json tools
  mcp-skill-client --config ./config.json stop
`);
}

// ============ Output Formatting ============

function getOutputDir(config, outputDir) {
  const dir = outputDir || config._outputDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getMimeExtension(mimeType) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'audio/wav': 'wav',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg'
  };
  return map[mimeType] || 'bin';
}

function saveBase64File(data, mimeType, outputDir, prefix = 'output') {
  const ext = getMimeExtension(mimeType);
  const timestamp = Date.now();
  const filename = `${prefix}-${timestamp}.${ext}`;
  const filepath = path.join(outputDir, filename);
  
  fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
  return filepath;
}

function formatToolsAuto(result) {
  if (!result.tools || !Array.isArray(result.tools)) {
    return JSON.stringify(result, null, 2);
  }
  
  const lines = [];
  for (const tool of result.tools) {
    const name = tool.name.padEnd(30);
    const desc = tool.description || '';
    lines.push(`${name} ${desc}`);
  }
  return lines.join('\n');
}

function formatCallResultAuto(result, config, outputDir) {
  const output = [];
  
  // Handle structured content
  if (result.structuredContent) {
    output.push(JSON.stringify(result.structuredContent, null, 2));
  }
  
  // Handle content array
  if (result.content && Array.isArray(result.content)) {
    for (const item of result.content) {
      switch (item.type) {
        case 'text':
          output.push(item.text);
          break;
          
        case 'image': {
          const dir = getOutputDir(config, outputDir);
          const filepath = saveBase64File(item.data, item.mimeType, dir, 'image');
          output.push(`[Image saved: ${filepath}]`);
          break;
        }
        
        case 'audio': {
          const dir = getOutputDir(config, outputDir);
          const filepath = saveBase64File(item.data, item.mimeType, dir, 'audio');
          output.push(`[Audio saved: ${filepath}]`);
          break;
        }
        
        case 'resource_link':
          output.push(`[Resource: ${item.uri}${item.name ? ` (${item.name})` : ''}]`);
          break;
          
        case 'resource':
          if (item.resource) {
            if (item.resource.text) {
              output.push(item.resource.text);
            } else if (item.resource.blob) {
              const dir = getOutputDir(config, outputDir);
              const mimeType = item.resource.mimeType || 'application/octet-stream';
              const filepath = saveBase64File(item.resource.blob, mimeType, dir, 'resource');
              output.push(`[Resource saved: ${filepath}]`);
            }
          }
          break;
          
        default:
          output.push(JSON.stringify(item));
      }
    }
  }
  
  // Handle error
  if (result.isError) {
    return `[Error] ${output.join('\n')}`;
  }
  
  return output.join('\n');
}

async function main() {
  const { config: configPath, command, toolArgs, daemonPort, format, outputDir } = parseArgs(args);
  
  if (!command) {
    printUsage();
    process.exit(0);
  }
  
  const config = loadConfig(configPath);
  
  switch (command) {
    case 'start':
      await startDaemon(config, daemonPort);
      break;
    case 'stop':
      await stopDaemon(config);
      break;
    case 'status':
      await statusDaemon(config, format);
      break;
    case 'tools':
      await listTools(config, format);
      break;
    case 'call':
      await callTool(config, toolArgs, format, outputDir);
      break;
    case 'daemon-run':
      // Internal command - run as daemon process
      await runDaemon(config, daemonPort);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// ============ Daemon Control ============

async function startDaemon(config, port) {
  const pidFile = path.join(config._stateDir, 'daemon.pid');
  const portFile = path.join(config._stateDir, 'daemon.port');
  const logFile = path.join(config._stateDir, 'daemon.log');
  
  // Check if already running
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    try {
      process.kill(pid, 0);
      console.log(`Daemon already running (PID: ${pid})`);
      return;
    } catch (e) {
      fs.unlinkSync(pidFile);
    }
  }
  
  // Start daemon process
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');
  
  const configAbsPath = path.resolve(config._configDir, path.basename(args[args.indexOf('--config') + 1]));
  
  const child = spawn('node', [__filename, '--config', configAbsPath, '--port', port.toString(), 'daemon-run'], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, ...config.env }
  });
  
  fs.writeFileSync(pidFile, child.pid.toString());
  fs.writeFileSync(portFile, port.toString());
  child.unref();
  
  // Wait and check
  await sleep(2000);
  
  try {
    const status = await httpGet(`http://localhost:${port}/status`);
    console.log(`Daemon started (PID: ${child.pid}, port: ${port})`);
    console.log(`Server: ${config.name}`);
  } catch (e) {
    console.error('Failed to start daemon. Check logs:', logFile);
  }
}

async function stopDaemon(config) {
  const pidFile = path.join(config._stateDir, 'daemon.pid');
  const portFile = path.join(config._stateDir, 'daemon.port');
  
  if (!fs.existsSync(pidFile)) {
    console.log('Daemon not running');
    return;
  }
  
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Daemon stopped (PID: ${pid})`);
  } catch (e) {
    console.log('Daemon process not found');
  }
  
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
}

async function statusDaemon(config, format) {
  const pidFile = path.join(config._stateDir, 'daemon.pid');
  const portFile = path.join(config._stateDir, 'daemon.port');
  
  if (!fs.existsSync(pidFile)) {
    console.log('Daemon not running');
    return;
  }
  
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  const port = fs.existsSync(portFile) ? parseInt(fs.readFileSync(portFile, 'utf8'), 10) : 8940;
  
  try {
    process.kill(pid, 0);
    const status = await httpGet(`http://localhost:${port}/status`);
    
    if (format === 'json') {
      console.log(status);
    } else {
      const parsed = JSON.parse(status);
      console.log(`Daemon running (PID: ${pid}, port: ${port})`);
      console.log(`Server: ${parsed.server}`);
      console.log(`Connected: ${parsed.connected}`);
      if (parsed.lastError) {
        console.log(`Last error: ${parsed.lastError}`);
      }
    }
  } catch (e) {
    console.log(`Daemon not responding (PID: ${pid})`);
  }
}

async function listTools(config, format) {
  const portFile = path.join(config._stateDir, 'daemon.port');
  
  if (!fs.existsSync(portFile)) {
    console.error('Daemon not running. Start it first.');
    process.exit(1);
  }
  
  const port = parseInt(fs.readFileSync(portFile, 'utf8'), 10);
  
  try {
    const result = await httpGet(`http://localhost:${port}/tools`);
    
    if (format === 'json') {
      console.log(result);
    } else {
      const parsed = JSON.parse(result);
      console.log(formatToolsAuto(parsed));
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

async function callTool(config, toolArgs, format, outputDir) {
  if (toolArgs.length === 0) {
    console.error('Usage: mcp-skill-client --config <config> call <tool> [key=value...]');
    process.exit(1);
  }
  
  const portFile = path.join(config._stateDir, 'daemon.port');
  
  if (!fs.existsSync(portFile)) {
    console.error('Daemon not running. Start it first.');
    process.exit(1);
  }
  
  const port = parseInt(fs.readFileSync(portFile, 'utf8'), 10);
  const toolName = toolArgs[0];
  const toolArguments = {};
  
  for (let i = 1; i < toolArgs.length; i++) {
    const arg = toolArgs[i];
    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      const key = arg.substring(0, eqIndex);
      let value = arg.substring(eqIndex + 1);
      // Try to parse JSON values
      try {
        value = JSON.parse(value);
      } catch (e) {
        // Keep as string
      }
      toolArguments[key] = value;
    }
  }
  
  try {
    const result = await httpPost(`http://localhost:${port}/call`, {
      tool: toolName,
      arguments: toolArguments
    });
    
    if (format === 'json') {
      console.log(result);
    } else {
      const parsed = JSON.parse(result);
      console.log(formatCallResultAuto(parsed, config, outputDir));
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

// ============ Daemon Process ============

async function runDaemon(config, port) {
  console.log(`[${new Date().toISOString()}] Starting daemon for ${config.name}`);
  
  const client = new Client({
    name: 'mcp-skill-client',
    version: '1.0.0'
  });
  
  let connected = false;
  let lastError = null;
  
  // Connect based on transport type
  try {
    if (config.transport === 'stdio') {
      console.log(`[${new Date().toISOString()}] Starting server: ${config.command} ${config.args?.join(' ') || ''}`);
      
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env },
        stderr: 'pipe'
      });
      
      // Capture stderr for logging
      transport.stderr?.on('data', (data) => {
        console.error(`[${new Date().toISOString()}] [server stderr] ${data.toString().trim()}`);
      });
      
      await client.connect(transport);
      connected = true;
      console.log(`[${new Date().toISOString()}] Connected via stdio`);
      
    } else if (config.transport === 'http') {
      console.log(`[${new Date().toISOString()}] Connecting to ${config.url}`);
      const transport = new StreamableHTTPClientTransport(new URL(config.url));
      await client.connect(transport);
      connected = true;
      console.log(`[${new Date().toISOString()}] Connected via HTTP`);
      
    } else {
      throw new Error(`Unknown transport: ${config.transport}`);
    }
  } catch (e) {
    lastError = e.message;
    console.error(`[${new Date().toISOString()}] Failed to connect:`, e.message);
  }
  
  // HTTP server for receiving commands
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected, lastError, server: config.name }));
      return;
    }
    
    if (url.pathname === '/tools' && req.method === 'GET') {
      try {
        if (!connected) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not connected to MCP server' }));
          return;
        }
        
        const result = await client.listTools();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    
    if (url.pathname === '/call' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { tool, arguments: toolArgs } = JSON.parse(body);
          
          if (!connected) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not connected to MCP server' }));
            return;
          }
          
          console.log(`[${new Date().toISOString()}] Calling tool: ${tool}`, toolArgs);
          
          const result = await client.callTool({ name: tool, arguments: toolArgs });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          console.error(`[${new Date().toISOString()}] Error:`, e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    
    res.writeHead(404);
    res.end('Not Found');
  });
  
  server.listen(port, 'localhost', () => {
    console.log(`[${new Date().toISOString()}] Daemon listening on http://localhost:${port}`);
  });
  
  // Handle shutdown
  const shutdown = () => {
    console.log(`[${new Date().toISOString()}] Shutting down...`);
    server.close();
    process.exit(0);
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ============ Utilities ============

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(data));
        } else {
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
