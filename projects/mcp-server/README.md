# Cursor Talk to Figma - MCP Server

This is the Model Context Protocol (MCP) server that enables Cursor AI to communicate with Figma through a standardized interface.

## Overview

The MCP server provides a bridge between Cursor AI and Figma, offering a comprehensive set of tools for:
- Reading and analyzing Figma designs
- Creating and modifying design elements
- Managing layouts and styling
- Handling components and prototypes
- Automating design workflows

## Installation

### NPM Installation (Recommended)
```bash
npm install -g cursor-talk-to-figma-mcp-server
```

### Local Development Installation
```bash
npm install
npm run build
```

## Configuration

Add the server to your Cursor MCP configuration in `~/.cursor/mcp.json`:

### Production Installation
```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "npx",
      "args": ["cursor-talk-to-figma-mcp-server@latest"]
    }
  }
}
```

### Local Development
```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "node",
      "args": ["/path-to-this-directory/dist/server.js"]
    }
  }
}
```

## Available Scripts

- `npm start` - Start the MCP server
- `npm run build` - Build the TypeScript project
- `npm run dev` - Start in development mode with file watching

## MCP Tools

The server provides comprehensive tools for Figma integration:

### Document & Selection Tools
- `get_document_info` - Get information about the current Figma document
- `get_selection` - Get information about the current selection
- `read_my_design` - Get detailed node information about the current selection
- `get_node_info` - Get detailed information about a specific node
- `get_nodes_info` - Get detailed information about multiple nodes

### Content Creation Tools
- `create_rectangle` - Create a new rectangle with position and size
- `create_frame` - Create a new frame with position and size
- `create_text` - Create a new text node with customizable properties

### Text Management Tools
- `scan_text_nodes` - Scan text nodes with intelligent chunking
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes

### Layout & Styling Tools
- `set_layout_mode` - Set auto-layout mode and wrap behavior
- `set_padding` - Set padding values for auto-layout frames
- `set_axis_align` - Set alignment for auto-layout frames
- `set_fill_color` - Set fill color (RGBA)
- `set_stroke_color` - Set stroke color and weight
- `move_node` - Move a node to a new position
- `resize_node` - Resize a node with new dimensions

### Component & Instance Tools
- `get_local_components` - Get information about local components
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from instances
- `set_instance_overrides` - Apply overrides to target instances

### Advanced Tools
- `get_annotations` - Get all annotations in the document
- `set_annotation` - Create or update annotations
- `get_reactions` - Get prototype reactions with visual highlights
- `create_connections` - Create FigJam connector lines
- `export_node_as_image` - Export nodes as images

### Connection Management
- `join_channel` - Join a specific channel for WebSocket communication

## Dependencies

- `@modelcontextprotocol/sdk` - Core MCP functionality
- `uuid` - Unique identifier generation
- `ws` - WebSocket client for Figma communication
- `zod` - Runtime type validation

## Architecture

The MCP server acts as a protocol adapter that:
1. Receives standardized MCP requests from Cursor AI
2. Translates them into Figma-specific commands
3. Sends commands to Figma via WebSocket connection
4. Returns structured responses back to Cursor

## Usage with WebSocket Server

This MCP server requires the WebSocket server to be running to communicate with Figma. Make sure to:
1. Start the WebSocket server
2. Configure and start this MCP server
3. Run the Figma plugin
4. Use `join_channel` to establish connection

## Error Handling

The server includes comprehensive error handling for:
- Network connection issues
- Invalid Figma operations
- Type validation errors
- WebSocket communication failures
