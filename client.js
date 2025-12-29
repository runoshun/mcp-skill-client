#!/usr/bin/env node
/**
 * Universal MCP Skill Client
 * 
 * A daemon-based client that maintains MCP session for any MCP server.
 * Supports both stdio and HTTP transports.
 * 
 * Usage:
 *   mcp-skill-client --config config.json --session mysession start
 *   mcp-skill-client --config config.json --session mysession call <tool> [args...]
 *   mcp-skill-client --config config.json --session mysession stop
 *   mcp-skill-client --config config.json --session mysession status
 *   mcp-skill-client --config config.json --session mysession tools
 */

import http from 'node:http';
import net from 'node:net';
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
    session: process.env.MCP_SESSION || null,
    command: null,
    toolArgs: [],
    format: 'auto',
    outputDir: null,
    // Internal use
    _daemonPort: null
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Handle --option=value format
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIndex = arg.indexOf('=');
      const key = arg.substring(2, eqIndex);
      const value = arg.substring(eqIndex + 1);
      
      switch (key) {
        case 'config': result.config = value; break;
        case 'session': result.session = value; break;
        case 'format': result.format = value; break;
        case 'output-dir': result.outputDir = value; break;
        case '_port': result._daemonPort = parseInt(value, 10); break;
        default: result.toolArgs.push(arg);
      }
    } else if (arg === '--config' && args[i + 1]) {
      result.config = args[i + 1];
      i++;
    } else if (arg === '--session' && args[i + 1]) {
      result.session = args[i + 1];
      i++;
    } else if (arg === '--format' && args[i + 1]) {
      result.format = args[i + 1];
      i++;
    } else if (arg === '--output-dir' && args[i + 1]) {
      result.outputDir = args[i + 1];
      i++;
    } else if (arg === '--_port' && args[i + 1]) {
      result._daemonPort = parseInt(args[i + 1], 10);
      i++;
    } else if (!result.command) {
      result.command = arg;
    } else {
      result.toolArgs.push(arg);
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
  config._configPath = absPath;
  config._configDir = path.dirname(absPath);
  
  return config;
}

// ============ Session Management ============

function getSessionDir(config) {
  // State dir is ./<skill-name>/ in current working directory
  const stateDir = path.join(process.cwd(), `.${config.name}`);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return stateDir;
}

function getSessionsFile(config) {
  return path.join(getSessionDir(config), 'sessions.json');
}

function loadSessions(config) {
  const sessionsFile = getSessionsFile(config);
  if (fs.existsSync(sessionsFile)) {
    try {
      return JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveSessions(config, sessions) {
  const sessionsFile = getSessionsFile(config);
  fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
}

function getSession(config, sessionName) {
  const sessions = loadSessions(config);
  return sessions[sessionName] || null;
}

function setSession(config, sessionName, data) {
  const sessions = loadSessions(config);
  sessions[sessionName] = data;
  saveSessions(config, sessions);
}

function deleteSession(config, sessionName) {
  const sessions = loadSessions(config);
  delete sessions[sessionName];
  saveSessions(config, sessions);
}

function getOutputDir(config, sessionName, outputDir) {
  if (outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    return outputDir;
  }
  const dir = path.join(getSessionDir(config), sessionName, 'output');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLogFile(config, sessionName) {
  const dir = path.join(getSessionDir(config), sessionName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'daemon.log');
}

// ============ Port Management ============

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, 'localhost');
  });
}

async function findAvailablePort(config, startPort = 8940) {
  const sessions = loadSessions(config);
  const usedPorts = new Set(Object.values(sessions).map(s => s.port));
  
  let port = startPort;
  while (port < startPort + 1000) {
    if (!usedPorts.has(port) && await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  throw new Error('No available port found');
}

function printUsage() {
  console.log(`Universal MCP Skill Client

Usage:
  mcp-skill-client --config <config.json> --session <name> <command> [options]

Commands:
  start                  Start daemon for session
  stop                   Stop daemon for session
  status                 Check daemon status
  tools                  List available tools
  call <tool> [args...]  Call MCP tool
  sessions               List all sessions

Options:
  --session <name>       Session name (required, or set MCP_SESSION env)
  --format <auto|json>   Output format (default: auto)
  --output-dir <dir>     Directory for saving images/audio

Environment:
  MCP_SESSION            Default session name

Config file format (config.json):
  {
    "name": "my-mcp-server",
    "transport": "stdio",
    "command": "npx",
    "args": ["@org/mcp-server@1.0.0"],
    "env": {}
  }

Examples:
  mcp-skill-client --config ./config.json --session dev start
  mcp-skill-client --config ./config.json --session dev call browser_navigate url=https://example.com
  mcp-skill-client --config ./config.json --session dev tools
  mcp-skill-client --config ./config.json --session dev stop
`);
}

// ============ Output Formatting ============

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

function formatCallResultAuto(result, config, sessionName, outputDir) {
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
          const dir = getOutputDir(config, sessionName, outputDir);
          const filepath = saveBase64File(item.data, item.mimeType, dir, 'image');
          output.push(`[Image saved: ${filepath}]`);
          break;
        }
        
        case 'audio': {
          const dir = getOutputDir(config, sessionName, outputDir);
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
              const dir = getOutputDir(config, sessionName, outputDir);
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
  const { config: configPath, session, command, toolArgs, format, outputDir, _daemonPort } = parseArgs(args);
  
  if (!command) {
    printUsage();
    process.exit(0);
  }
  
  // sessions command doesn't require session name
  if (command === 'sessions') {
    const config = loadConfig(configPath);
    await listSessions(config, format);
    return;
  }
  
  // daemon-run is internal command
  if (command === 'daemon-run') {
    const config = loadConfig(configPath);
    await runDaemon(config, session, _daemonPort);
    return;
  }
  
  if (!session) {
    console.error('Error: --session is required (or set MCP_SESSION environment variable)');
    process.exit(1);
  }
  
  const config = loadConfig(configPath);
  
  switch (command) {
    case 'start':
      await startDaemon(config, session);
      break;
    case 'stop':
      await stopDaemon(config, session);
      break;
    case 'status':
      await statusDaemon(config, session, format);
      break;
    case 'tools':
      await listTools(config, session, format);
      break;
    case 'call':
      await callTool(config, session, toolArgs, format, outputDir);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// ============ Daemon Control ============

async function startDaemon(config, sessionName) {
  const existingSession = getSession(config, sessionName);
  
  // Check if already running
  if (existingSession) {
    try {
      process.kill(existingSession.pid, 0);
      console.log(`Session '${sessionName}' already running (PID: ${existingSession.pid}, port: ${existingSession.port})`);
      return;
    } catch (e) {
      // Process not running, clean up
      deleteSession(config, sessionName);
    }
  }
  
  // Find available port
  const port = await findAvailablePort(config);
  
  // Start daemon process
  const logFile = getLogFile(config, sessionName);
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');
  
  const child = spawn('node', [
    __filename,
    '--config', config._configPath,
    '--session', sessionName,
    '--_port', port.toString(),
    'daemon-run'
  ], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, ...config.env }
  });
  
  // Save session info
  setSession(config, sessionName, {
    pid: child.pid,
    port: port,
    startedAt: new Date().toISOString()
  });
  
  child.unref();
  
  // Wait and check
  await sleep(2000);
  
  try {
    await httpGet(`http://localhost:${port}/status`);
    console.log(`Session '${sessionName}' started (PID: ${child.pid}, port: ${port})`);
    console.log(`Server: ${config.name}`);
  } catch (e) {
    console.error('Failed to start daemon. Check logs:', logFile);
    deleteSession(config, sessionName);
  }
}

async function stopDaemon(config, sessionName) {
  const session = getSession(config, sessionName);
  
  if (!session) {
    console.log(`Session '${sessionName}' not running`);
    return;
  }
  
  try {
    process.kill(session.pid, 'SIGTERM');
    console.log(`Session '${sessionName}' stopped (PID: ${session.pid})`);
  } catch (e) {
    console.log('Daemon process not found');
  }
  
  deleteSession(config, sessionName);
}

async function statusDaemon(config, sessionName, format) {
  const session = getSession(config, sessionName);
  
  if (!session) {
    console.log(`Session '${sessionName}' not running`);
    return;
  }
  
  try {
    process.kill(session.pid, 0);
    const status = await httpGet(`http://localhost:${session.port}/status`);
    
    if (format === 'json') {
      console.log(status);
    } else {
      const parsed = JSON.parse(status);
      console.log(`Session '${sessionName}' running (PID: ${session.pid}, port: ${session.port})`);
      console.log(`Server: ${parsed.server}`);
      console.log(`Connected: ${parsed.connected}`);
      if (parsed.lastError) {
        console.log(`Last error: ${parsed.lastError}`);
      }
    }
  } catch (e) {
    console.log(`Session '${sessionName}' not responding (PID: ${session.pid})`);
  }
}

async function listSessions(config, format) {
  const sessions = loadSessions(config);
  
  if (format === 'json') {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  
  const entries = Object.entries(sessions);
  if (entries.length === 0) {
    console.log('No active sessions');
    return;
  }
  
  for (const [name, info] of entries) {
    let status = 'unknown';
    try {
      process.kill(info.pid, 0);
      status = 'running';
    } catch (e) {
      status = 'dead';
    }
    console.log(`${name.padEnd(20)} PID: ${info.pid}, port: ${info.port}, status: ${status}`);
  }
}

async function listTools(config, sessionName, format) {
  const session = getSession(config, sessionName);
  
  if (!session) {
    console.error(`Session '${sessionName}' not running. Start it first.`);
    process.exit(1);
  }
  
  try {
    const result = await httpGet(`http://localhost:${session.port}/tools`);
    
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

async function callTool(config, sessionName, toolArgs, format, outputDir) {
  if (toolArgs.length === 0) {
    console.error('Usage: mcp-skill-client --config <config> --session <name> call <tool> [key=value...]');
    process.exit(1);
  }
  
  const session = getSession(config, sessionName);
  
  if (!session) {
    console.error(`Session '${sessionName}' not running. Start it first.`);
    process.exit(1);
  }
  
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
    const result = await httpPost(`http://localhost:${session.port}/call`, {
      tool: toolName,
      arguments: toolArguments
    });
    
    if (format === 'json') {
      console.log(result);
    } else {
      const parsed = JSON.parse(result);
      console.log(formatCallResultAuto(parsed, config, sessionName, outputDir));
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

// ============ Daemon Process ============

async function runDaemon(config, sessionName, port) {
  console.log(`[${new Date().toISOString()}] Starting daemon for ${config.name} (session: ${sessionName})`);
  
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
      res.end(JSON.stringify({ connected, lastError, server: config.name, session: sessionName }));
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
