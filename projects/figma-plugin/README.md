# Cursor Talk to Figma - Figma Plugin

This is the Figma plugin component that enables communication between Figma and Cursor AI through the WebSocket server.

## Overview

This Figma plugin:
- Connects to the WebSocket server
- Receives commands from Cursor AI via the MCP server
- Executes design operations within Figma
- Sends responses back to Cursor

## Installation

### Option 1: Install from Figma Community (Recommended)
Install the plugin from the [Figma community page](https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin)

### Option 2: Local Development Installation
1. In Figma, go to Plugins > Development > New Plugin
2. Choose "Link existing plugin"
3. Select the `manifest.json` file from this directory
4. The plugin should now be available in your Figma development plugins

## Usage

1. Make sure the WebSocket server is running
2. Open Figma and run the "Cursor MCP Plugin"
3. The plugin will attempt to connect to the WebSocket server
4. Use Cursor AI to send commands to Figma through the MCP integration

## Plugin Features

The plugin supports all the MCP tools available in the integration:

### Document & Selection
- Reading document information
- Getting current selection details
- Reading design nodes

### Content Modification
- Creating shapes (rectangles, frames, text)
- Modifying text content
- Setting colors and styling

### Layout & Organization
- Moving and resizing nodes
- Setting auto-layout properties
- Managing spacing and alignment

### Advanced Features
- Component instance management
- Annotation system
- Prototype reaction handling
- Export capabilities

## Development

To modify the plugin:

1. Edit the source files:
   - `code.js` - Main plugin logic
   - `ui.html` - Plugin UI
   - `setcharacters.js` - Additional utilities
   - `manifest.json` - Plugin configuration

2. Reload the plugin in Figma to see changes

## Network Access

The plugin is configured to communicate with:
- Production: Various allowed domains
- Development: `http://localhost:3055` and `ws://localhost:3055`

## Permissions

The plugin uses:
- Dynamic page access for reading/writing design data
- Proposed API access for advanced features
- Private plugin API access for extended capabilities
