# Cursor Talk to Figma - WebSocket Server

This is the WebSocket server component that facilitates communication between the MCP server and Figma plugin for the Cursor Talk to Figma integration.

## Overview

The WebSocket server acts as a bridge between:
- The MCP server (which communicates with Cursor AI)
- The Figma plugin (which runs inside Figma)

## Getting Started

1. Install dependencies:
```bash
bun install
```

2. Start the WebSocket server:
```bash
bun start
```

The server will start on `http://localhost:3055` by default.

## Available Scripts

- `bun start` - Start the WebSocket server using Bun
- `bun socket-node` - Start the WebSocket server using Node.js
- `bun setup` - Run the setup script
- `bun build` - Build the project
- `bun dev` - Start development mode with file watching

## Windows + WSL Setup

For Windows users with WSL, uncomment the hostname configuration in `socket.ts`:

```typescript
// uncomment this to allow connections in windows wsl
hostname: "0.0.0.0",
```

## Configuration

The server can be configured by modifying the constants in `socket.ts`:
- Port number
- Hostname
- CORS settings

## Usage

1. Start this WebSocket server
2. Install and configure the MCP server in Cursor
3. Open Figma and run the Cursor MCP Plugin
4. Connect the plugin to this WebSocket server

The server will handle message routing between Cursor and Figma, enabling seamless design automation workflows.
