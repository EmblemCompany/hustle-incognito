#!/usr/bin/env node
/**
 * Simple HTTP server for the auth-chat-demo.html example.
 *
 * Usage:
 *   node examples/serve-demo.js
 *
 * Then open http://localhost:3000/examples/auth-chat-demo.html
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  // Remove query string
  let pathname = req.url.split('?')[0];

  // Default to index
  if (pathname === '/') {
    pathname = '/examples/auth-chat-demo.html';
  }

  const filePath = path.join(ROOT_DIR, pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end(`Not found: ${pathname}`);
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }

    // Add CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  Hustle Incognito + Emblem Auth Demo Server                   ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Server running at: http://localhost:${PORT}                    ║
║                                                               ║
║  Open: http://localhost:${PORT}/examples/auth-chat-demo.html    ║
║                                                               ║
║  Press Ctrl+C to stop                                         ║
╚═══════════════════════════════════════════════════════════════╝
`);
});
