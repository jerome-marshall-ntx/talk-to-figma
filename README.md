# Cursor Talk to Figma - Project Suite

This repository contains three separate but interconnected projects that enable seamless integration between Cursor AI and Figma for design automation and collaboration.

## Project Structure

This monorepo has been organized into three distinct projects:

### 1. **MCP Server** (`/projects/mcp-server/`)
The Model Context Protocol server that provides the interface between Cursor AI and the WebSocket communication layer.

**Key Features:**
- Standardized MCP tools for Figma operations
- Type-safe command validation
- Comprehensive error handling
- Support for all major Figma operations

**Installation:** `npm install -g cursor-talk-to-figma-mcp-server`

### 2. **WebSocket Server** (`/projects/websocket-server/`)
The communication bridge that facilitates real-time messaging between the MCP server and Figma plugin.

**Key Features:**
- Real-time bidirectional communication
- Channel-based message routing
- Cross-platform compatibility (Bun/Node.js)
- CORS and security configuration

**Usage:** `bun start` or `npm start`

### 3. **Figma Plugin** (`/projects/figma-plugin/`)
The Figma plugin that executes design operations within Figma and communicates with the WebSocket server.

**Key Features:**
- Complete Figma API integration
- Real-time design manipulation
- Support for complex design workflows
- Community plugin distribution

**Installation:** Available on [Figma Community](https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin)

## Architecture Overview

```
Cursor AI ←→ MCP Server ←→ WebSocket Server ←→ Figma Plugin ←→ Figma
```

1. **Cursor AI** sends design commands through the MCP protocol
2. **MCP Server** validates and processes commands, forwards to WebSocket server
3. **WebSocket Server** routes messages between MCP server and Figma plugin
4. **Figma Plugin** executes operations within Figma and returns results
5. Responses flow back through the chain to Cursor AI

## Quick Start

### Complete Setup (All Projects)

1. **Install WebSocket Server:**
   ```bash
   cd projects/websocket-server
   bun install
   bun start
   ```

2. **Install MCP Server:**
   ```bash
   cd projects/mcp-server
   npm install
   npm run build
   ```

3. **Configure Cursor:**
   Add to `~/.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "TalkToFigma": {
         "command": "node",
         "args": ["/path/to/projects/mcp-server/dist/server.js"]
       }
     }
   }
   ```

4. **Install Figma Plugin:**
   - Install from [Figma Community](https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin), or
   - Load locally: Figma → Plugins → Development → Link existing plugin → Select `projects/figma-plugin/manifest.json`

5. **Connect Everything:**
   - Start WebSocket server
   - Open Figma and run the plugin
   - Use Cursor AI to send design commands

## Development

Each project can be developed independently:

- **MCP Server:** TypeScript development with MCP SDK
- **WebSocket Server:** Bun/Node.js with real-time communication
- **Figma Plugin:** JavaScript with Figma Plugin API

See individual project READMEs for detailed development instructions.

## Use Cases

- **Design Automation:** Automate repetitive design tasks
- **Content Management:** Bulk text and asset updates
- **Layout Generation:** Programmatic layout creation
- **Design Analysis:** Extract design information and metrics
- **Prototype Enhancement:** Convert prototypes to visual flows
- **Annotation Systems:** Automated annotation management

## Best Practices

1. Always start the WebSocket server first
2. Ensure proper channel connection with `join_channel`
3. Use batch operations for multiple modifications
4. Handle errors gracefully in design workflows
5. Test with small design files before scaling up

## Contributing

Each project maintains its own development workflow:
- Follow TypeScript best practices for MCP server
- Use modern JavaScript for Figma plugin development
- Ensure real-time communication reliability in WebSocket server

## License

MIT License - See individual project directories for specific licensing information.

## Support

- **Issues:** Report issues in the respective project directories
- **Documentation:** Each project contains detailed README files
- **Community:** Join discussions about MCP and Figma automation

---

**Note:** This project structure allows for independent development, deployment, and maintenance of each component while maintaining clear separation of concerns and enabling modular usage.
