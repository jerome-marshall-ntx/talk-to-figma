#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import express from "express"
import cors from "cors"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import WebSocket from "ws"
import { v4 as uuidv4 } from "uuid"
import process from "node:process"

// Define TypeScript interfaces for Figma responses
interface FigmaResponse {
  id: string
  result?: any
  error?: string
}

// Update the getInstanceOverridesResult interface to match the plugin implementation
interface getInstanceOverridesResult {
  sourceComponentKey: string
  sourceComponentId: string
  sourceInstanceId: string
  overrides: any[]
  success: boolean
  message: string
}

interface setInstanceOverridesResult {
  sourceInstanceId: string
  targetInstanceIds: string[]
  appliedOverrides: any[]
  success: boolean
  message: string
}

// Define interface for command progress updates
interface CommandProgressUpdate {
  type: "command_progress"
  commandId: string
  commandType: string
  status: "started" | "in_progress" | "completed" | "error"
  progress: number
  totalItems: number
  processedItems: number
  currentChunk?: number
  totalChunks?: number
  chunkSize?: number
  message: string
  payload?: any
  timestamp: number
}

// Custom logging functions
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  debug: (message: string) => console.log(`[DEBUG] ${message}`),
  warn: (message: string) => console.log(`[WARN] ${message}`),
  error: (message: string) => console.log(`[ERROR] ${message}`),
  log: (message: string) => console.log(`[LOG] ${message}`),
}

// WebSocket connection and request tracking for Figma communication
let ws: WebSocket | null = null
const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    timeout: ReturnType<typeof setTimeout>
    lastActivity: number
  }
>()

// WebSocket server URL for Figma communication
const serverUrl = "talk-to-figma-socket.onrender.com"
const WS_URL = `wss://${serverUrl}`

// Function to connect to the Figma WebSocket server
function connectToFigma() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    logger.info("Already connected to Figma")
    return
  }

  logger.info(`Connecting to Figma socket server at ${WS_URL}...`)
  ws = new WebSocket(WS_URL)

  ws.on("open", () => {
    logger.info("Connected to Figma socket server")
  })

  ws.on("message", (data: any) => {
    try {
      interface ProgressMessage {
        message: FigmaResponse | any
        type?: string
        id?: string
        [key: string]: any
      }

      const json = JSON.parse(data) as ProgressMessage

      // Handle progress updates
      if (json.type === "progress_update") {
        const progressData = json.message.data as CommandProgressUpdate
        const requestId = json.id || ""

        if (requestId && pendingRequests.has(requestId)) {
          const request = pendingRequests.get(requestId)!
          request.lastActivity = Date.now()
          clearTimeout(request.timeout)
          request.timeout = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              logger.error(
                `Request ${requestId} timed out after extended period of inactivity`
              )
              pendingRequests.delete(requestId)
              request.reject(new Error("Request to Figma timed out"))
            }
          }, 60000)

          logger.info(
            `Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`
          )
        }
        return
      }

      // Handle regular responses
      const myResponse = json.message
      logger.debug(`Received message: ${JSON.stringify(myResponse)}`)

      if (
        myResponse.id &&
        pendingRequests.has(myResponse.id) &&
        myResponse.result
      ) {
        const request = pendingRequests.get(myResponse.id)!
        clearTimeout(request.timeout)

        if (myResponse.error) {
          logger.error(`Error from Figma: ${myResponse.error}`)
          request.reject(new Error(myResponse.error))
        } else {
          if (myResponse.result) {
            request.resolve(myResponse.result)
          }
        }

        pendingRequests.delete(myResponse.id)
      } else {
        logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`)
      }
    } catch (error) {
      logger.error(
        `Error parsing message: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  })

  ws.on("error", (error) => {
    logger.error(`Socket error: ${error}`)
  })

  ws.on("close", () => {
    logger.info("Disconnected from Figma socket server")
    ws = null

    // Reject all pending requests
    for (const [id, request] of pendingRequests.entries()) {
      clearTimeout(request.timeout)
      request.reject(new Error("Connection closed"))
      pendingRequests.delete(id)
    }

    // Attempt to reconnect
    logger.info("Attempting to reconnect in 2 seconds...")
    setTimeout(() => connectToFigma(), 2000)
  })
}

// Function to join a channel
async function joinChannel(channelName: string): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma")
  }

  try {
    await sendCommandToFigma("join", { channel: channelName }, channelName)
    logger.info(`Joined channel: ${channelName}`)
  } catch (error) {
    logger.error(
      `Failed to join channel: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    throw error
  }
}

// Function to send commands to Figma
function sendCommandToFigma(
  command: string,
  params: unknown = {},
  channel: string,
  timeoutMs: number = 30000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma()
      reject(new Error("Not connected to Figma. Attempting to connect..."))
      return
    }

    if (command !== "join" && (!channel || typeof channel !== "string")) {
      reject(new Error("Channel parameter is required for this command"))
      return
    }

    const id = uuidv4()
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      channel: command === "join" ? (params as any).channel : channel,
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id,
        },
      },
    }

    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        logger.error(
          `Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`
        )
        reject(new Error("Request to Figma timed out"))
      }
    }, timeoutMs)

    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      lastActivity: Date.now(),
    })

    logger.info(`Sending command to Figma: ${command}`)
    logger.debug(`Request details: ${JSON.stringify(request)}`)
    ws.send(JSON.stringify(request))
  })
}

// Create MCP server
function createMcpServer() {
  const server = new McpServer({
    name: "TalkToFigmaMCP",
    version: "1.0.0",
  })

  // Helper function to filter Figma node responses
  function filterFigmaNode(node: any) {
    if (node.type === "VECTOR") {
      return null
    }

    const filtered: any = {
      id: node.id,
      name: node.name,
      type: node.type,
    }

    if (node.fills && node.fills.length > 0) {
      filtered.fills = node.fills.map((fill: any) => {
        const processedFill = { ...fill }
        delete processedFill.boundVariables
        delete processedFill.imageRef
        return processedFill
      })
    }

    if (node.children) {
      filtered.children = node.children
        .map((child: any) => filterFigmaNode(child))
        .filter((child: any) => child !== null)
    }

    return filtered
  }

  // Helper function to convert RGBA to hex
  function rgbaToHex(color: any): string {
    const toHex = (value: number) => {
      const hex = Math.round(value * 255).toString(16)
      return hex.length === 1 ? "0" + hex : hex
    }

    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
  }

  // Join Channel Tool
  server.tool(
    "join_channel",
    "Join a specific channel to communicate with Figma. Returns the channel name for use in subsequent commands.",
    {
      channel: z
        .string()
        .describe("The name of the channel to join")
        .default(""),
    },
    async ({ channel }: any) => {
      try {
        if (!channel) {
          return {
            content: [
              {
                type: "text",
                text: "Please provide a channel name to join:",
              },
            ],
          }
        }

        await joinChannel(channel)
        return {
          content: [
            {
              type: "text",
              text: `Successfully joined channel: ${channel}\n\nIMPORTANT: Use channel "${channel}" in all subsequent commands to communicate with this Figma plugin session.`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error joining channel: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Document Info Tool
  server.tool(
    "get_document_info",
    "Get detailed information about the current Figma document",
    {
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_document_info",
          {},
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting document info: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Selection Tool
  server.tool(
    "get_selection",
    "Get information about the current selection in Figma",
    {
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ channel }: any) => {
      try {
        const result = await sendCommandToFigma("get_selection", {}, channel)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting selection: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Create Rectangle Tool
  server.tool(
    "create_rectangle",
    "Create a new rectangle in Figma",
    {
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
      width: z.number().describe("Width of the rectangle"),
      height: z.number().describe("Height of the rectangle"),
      name: z.string().optional().describe("Optional name for the rectangle"),
      parentId: z
        .string()
        .optional()
        .describe("Optional parent node ID to append the rectangle to"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ x, y, width, height, name, parentId, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "create_rectangle",
          {
            x,
            y,
            width,
            height,
            name: name || "Rectangle",
            parentId,
          },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Created rectangle "${JSON.stringify(result)}"`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating rectangle: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Create Text Tool
  server.tool(
    "create_text",
    "Create a new text element in Figma",
    {
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
      text: z.string().describe("Text content"),
      fontSize: z.number().optional().describe("Font size (default: 14)"),
      fontWeight: z
        .number()
        .optional()
        .describe("Font weight (e.g., 400 for Regular, 700 for Bold)"),
      fontColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Font color in RGBA format"),
      name: z
        .string()
        .optional()
        .describe("Semantic layer name for the text node"),
      parentId: z
        .string()
        .optional()
        .describe("Optional parent node ID to append the text to"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({
      x,
      y,
      text,
      fontSize,
      fontWeight,
      fontColor,
      name,
      parentId,
      channel,
    }: any) => {
      try {
        const result = await sendCommandToFigma(
          "create_text",
          {
            x,
            y,
            text,
            fontSize: fontSize || 14,
            fontWeight: fontWeight || 400,
            fontColor: fontColor || { r: 0, g: 0, b: 0, a: 1 },
            name: name || "Text",
            parentId,
          },
          channel
        )
        const typedResult = result as { name: string; id: string }
        return {
          content: [
            {
              type: "text",
              text: `Created text "${typedResult.name}" with ID: ${typedResult.id}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating text: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Read My Design Tool
  server.tool(
    "read_my_design",
    "Get detailed information about the current selection in Figma, including all node details",
    {
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ channel }: any) => {
      try {
        const result = await sendCommandToFigma("read_my_design", {}, channel)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading design: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Node Info Tool
  server.tool(
    "get_node_info",
    "Get detailed information about a specific node in Figma",
    {
      nodeId: z
        .string()
        .describe("The ID of the node to get information about"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_node_info",
          { nodeId },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting node info: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Nodes Info Tool
  server.tool(
    "get_nodes_info",
    "Get detailed information about multiple nodes in Figma",
    {
      nodeIds: z
        .array(z.string())
        .describe("Array of node IDs to get information about"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeIds, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_nodes_info",
          { nodeIds },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting nodes info: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Create Frame Tool
  server.tool(
    "create_frame",
    "Create a new frame in Figma",
    {
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
      width: z.number().describe("Width of the frame"),
      height: z.number().describe("Height of the frame"),
      name: z.string().optional().describe("Optional name for the frame"),
      parentId: z
        .string()
        .optional()
        .describe("Optional parent node ID to append the frame to"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Fill color in RGBA format"),
      strokeColor: z
        .object({
          r: z.number().min(0).max(1).describe("Red component (0-1)"),
          g: z.number().min(0).max(1).describe("Green component (0-1)"),
          b: z.number().min(0).max(1).describe("Blue component (0-1)"),
          a: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("Alpha component (0-1)"),
        })
        .optional()
        .describe("Stroke color in RGBA format"),
      strokeWeight: z.number().positive().optional().describe("Stroke weight"),
      layoutMode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL"])
        .optional()
        .describe("Auto-layout mode for the frame"),
      layoutWrap: z
        .enum(["NO_WRAP", "WRAP"])
        .optional()
        .describe("Whether the auto-layout frame wraps its children"),
      paddingTop: z
        .number()
        .optional()
        .describe("Top padding for auto-layout frame"),
      paddingRight: z
        .number()
        .optional()
        .describe("Right padding for auto-layout frame"),
      paddingBottom: z
        .number()
        .optional()
        .describe("Bottom padding for auto-layout frame"),
      paddingLeft: z
        .number()
        .optional()
        .describe("Left padding for auto-layout frame"),
      primaryAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
        .optional()
        .describe(
          "Primary axis alignment for auto-layout frame. Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."
        ),
      counterAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "BASELINE"])
        .optional()
        .describe("Counter axis alignment for auto-layout frame"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Horizontal sizing mode for auto-layout frame"),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe("Vertical sizing mode for auto-layout frame"),
      itemSpacing: z
        .number()
        .optional()
        .describe(
          "Distance between children in auto-layout frame. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({
      x,
      y,
      width,
      height,
      name,
      parentId,
      fillColor,
      strokeColor,
      strokeWeight,
      layoutMode,
      layoutWrap,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      layoutSizingHorizontal,
      layoutSizingVertical,
      itemSpacing,
      channel,
    }: any) => {
      try {
        const result = await sendCommandToFigma(
          "create_frame",
          {
            x,
            y,
            width,
            height,
            name: name || "Frame",
            parentId,
            fillColor,
            strokeColor,
            strokeWeight,
            layoutMode,
            layoutWrap,
            paddingTop,
            paddingRight,
            paddingBottom,
            paddingLeft,
            primaryAxisAlignItems,
            counterAxisAlignItems,
            layoutSizingHorizontal,
            layoutSizingVertical,
            itemSpacing,
          },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Created frame: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating frame: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Fill Color Tool
  server.tool(
    "set_fill_color",
    "Set the fill color of a node in Figma can be TextNode or FrameNode",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, r, g, b, a, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_fill_color",
          { nodeId, r, g, b, a },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set fill color for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting fill color: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Stroke Color Tool
  server.tool(
    "set_stroke_color",
    "Set the stroke color of a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      r: z.number().min(0).max(1).describe("Red component (0-1)"),
      g: z.number().min(0).max(1).describe("Green component (0-1)"),
      b: z.number().min(0).max(1).describe("Blue component (0-1)"),
      a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
      weight: z.number().positive().optional().describe("Stroke weight"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, r, g, b, a, weight, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_stroke_color",
          { nodeId, r, g, b, a, weight },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set stroke color for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting stroke color: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Move Node Tool
  server.tool(
    "move_node",
    "Move a node to a new position in Figma",
    {
      nodeId: z.string().describe("The ID of the node to move"),
      x: z.number().describe("New X position"),
      y: z.number().describe("New Y position"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, x, y, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "move_node",
          { nodeId, x, y },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Moved node ${nodeId} to (${x}, ${y}): ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error moving node: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Clone Node Tool
  server.tool(
    "clone_node",
    "Clone an existing node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to clone"),
      x: z.number().optional().describe("New X position for the clone"),
      y: z.number().optional().describe("New Y position for the clone"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, x, y, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "clone_node",
          { nodeId, x, y },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Cloned node ${nodeId}: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error cloning node: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Resize Node Tool
  server.tool(
    "resize_node",
    "Resize a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to resize"),
      width: z.number().positive().describe("New width"),
      height: z.number().positive().describe("New height"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, width, height, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "resize_node",
          { nodeId, width, height },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Resized node ${nodeId} to ${width}x${height}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error resizing node: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Delete Node Tool
  server.tool(
    "delete_node",
    "Delete a node from Figma",
    {
      nodeId: z.string().describe("The ID of the node to delete"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "delete_node",
          { nodeId },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Deleted node ${nodeId}: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting node: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Delete Multiple Nodes Tool
  server.tool(
    "delete_multiple_nodes",
    "Delete multiple nodes from Figma at once",
    {
      nodeIds: z.array(z.string()).describe("Array of node IDs to delete"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeIds, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "delete_multiple_nodes",
          { nodeIds },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Deleted nodes: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting nodes: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Export Node as Image Tool
  server.tool(
    "export_node_as_image",
    "Export a node as an image from Figma",
    {
      nodeId: z.string().describe("The ID of the node to export"),
      format: z
        .enum(["PNG", "JPG", "SVG", "PDF"])
        .optional()
        .describe("Export format"),
      scale: z.number().positive().optional().describe("Export scale"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, format, scale, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "export_node_as_image",
          { nodeId, format, scale },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Exported node ${nodeId}: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting node: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Text Content Tool
  server.tool(
    "set_text_content",
    "Set the text content of an existing text node in Figma",
    {
      nodeId: z.string().describe("The ID of the text node to modify"),
      text: z.string().describe("New text content"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, text, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_text_content",
          { nodeId, text },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set text content for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting text content: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Styles Tool
  server.tool(
    "get_styles",
    "Get all styles from the current Figma document",
    {
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ channel }: any) => {
      try {
        const result = await sendCommandToFigma("get_styles", {}, channel)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting styles: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Local Components Tool
  server.tool(
    "get_local_components",
    "Get all local components from the Figma document",
    {
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_local_components",
          {},
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting local components: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Annotations Tool
  server.tool(
    "get_annotations",
    "Get all annotations in the current document or specific node",
    {
      nodeId: z
        .string()
        .describe("node ID to get annotations for specific node"),
      includeCategories: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to include category information"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, includeCategories, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_annotations",
          { nodeId, includeCategories },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting annotations: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Annotation Tool
  server.tool(
    "set_annotation",
    "Create or update an annotation",
    {
      nodeId: z.string().describe("The ID of the node to annotate"),
      annotationId: z
        .string()
        .optional()
        .describe(
          "The ID of the annotation to update (if updating existing annotation)"
        ),
      labelMarkdown: z
        .string()
        .describe("The annotation text in markdown format"),
      categoryId: z
        .string()
        .optional()
        .describe("The ID of the annotation category"),
      properties: z
        .array(
          z.object({
            type: z.string(),
          })
        )
        .optional()
        .describe("Additional properties for the annotation"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({
      nodeId,
      annotationId,
      labelMarkdown,
      categoryId,
      properties,
      channel,
    }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_annotation",
          { nodeId, annotationId, labelMarkdown, categoryId, properties },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set annotation: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting annotation: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Multiple Annotations Tool
  server.tool(
    "set_multiple_annotations",
    "Set multiple annotations parallelly in a node",
    {
      nodeId: z
        .string()
        .describe("The ID of the node containing the elements to annotate"),
      annotations: z
        .array(
          z.object({
            nodeId: z.string().describe("The ID of the node to annotate"),
            labelMarkdown: z
              .string()
              .describe("The annotation text in markdown format"),
            categoryId: z
              .string()
              .optional()
              .describe("The ID of the annotation category"),
            annotationId: z
              .string()
              .optional()
              .describe(
                "The ID of the annotation to update (if updating existing annotation)"
              ),
            properties: z
              .array(
                z.object({
                  type: z.string(),
                })
              )
              .optional()
              .describe("Additional properties for the annotation"),
          })
        )
        .describe("Array of annotations to apply"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, annotations, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_multiple_annotations",
          { nodeId, annotations },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set multiple annotations: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting multiple annotations: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Create Component Instance Tool
  server.tool(
    "create_component_instance",
    "Create an instance of a component in Figma",
    {
      componentKey: z.string().describe("Key of the component to instantiate"),
      x: z.number().describe("X position"),
      y: z.number().describe("Y position"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ componentKey, x, y, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "create_component_instance",
          { componentKey, x, y },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Created component instance: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating component instance: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Instance Overrides Tool
  server.tool(
    "get_instance_overrides",
    "Get all override properties from a selected component instance. These overrides can be applied to other instances, which will swap them to match the source component.",
    {
      nodeId: z
        .string()
        .optional()
        .describe(
          "Optional ID of the component instance to get overrides from. If not provided, currently selected instance will be used."
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_instance_overrides",
          { nodeId },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Got instance overrides: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting instance overrides: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Instance Overrides Tool
  server.tool(
    "set_instance_overrides",
    "Apply previously copied overrides to selected component instances. Target instances will be swapped to the source component and all copied override properties will be applied.",
    {
      sourceInstanceId: z
        .string()
        .describe("ID of the source component instance"),
      targetNodeIds: z
        .array(z.string())
        .describe(
          "Array of target instance IDs. Currently selected instances will be used."
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ sourceInstanceId, targetNodeIds, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_instance_overrides",
          { sourceInstanceId, targetNodeIds },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set instance overrides: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting instance overrides: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Corner Radius Tool
  server.tool(
    "set_corner_radius",
    "Set the corner radius of a node in Figma",
    {
      nodeId: z.string().describe("The ID of the node to modify"),
      radius: z.number().min(0).describe("Corner radius value"),
      corners: z
        .array(z.boolean())
        .length(4)
        .optional()
        .describe(
          "Optional array of 4 booleans to specify which corners to round [topLeft, topRight, bottomRight, bottomLeft]"
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, radius, corners, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_corner_radius",
          { nodeId, radius, corners },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set corner radius for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting corner radius: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Text Node Scanning Tool
  server.tool(
    "scan_text_nodes",
    "Scan all text nodes in the selected Figma node",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "scan_text_nodes",
          { nodeId },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning text nodes: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Node Type Scanning Tool
  server.tool(
    "scan_nodes_by_types",
    "Scan for child nodes with specific types in the selected Figma node",
    {
      nodeId: z.string().describe("ID of the node to scan"),
      types: z
        .array(z.string())
        .describe(
          "Array of node types to find in the child nodes (e.g. ['COMPONENT', 'FRAME'])"
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, types, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "scan_nodes_by_types",
          { nodeId, types },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error scanning nodes by types: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Multiple Text Contents Tool
  server.tool(
    "set_multiple_text_contents",
    "Set multiple text contents parallelly in a node",
    {
      nodeId: z
        .string()
        .describe("The ID of the node containing the text nodes to replace"),
      text: z
        .array(
          z.object({
            nodeId: z.string().describe("The ID of the text node"),
            text: z.string().describe("The replacement text"),
          })
        )
        .describe("Array of text node IDs and their replacement texts"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, text, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_multiple_text_contents",
          { nodeId, text },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set multiple text contents: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting multiple text contents: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Layout Mode Tool
  server.tool(
    "set_layout_mode",
    "Set the layout mode and wrap behavior of a frame in Figma",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      layoutMode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL"])
        .describe("Layout mode for the frame"),
      layoutWrap: z
        .enum(["NO_WRAP", "WRAP"])
        .optional()
        .describe("Whether the auto-layout frame wraps its children"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, layoutMode, layoutWrap, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_layout_mode",
          { nodeId, layoutMode, layoutWrap },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set layout mode for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting layout mode: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Padding Tool
  server.tool(
    "set_padding",
    "Set padding values for an auto-layout frame in Figma",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      paddingTop: z.number().optional().describe("Top padding value"),
      paddingRight: z.number().optional().describe("Right padding value"),
      paddingBottom: z.number().optional().describe("Bottom padding value"),
      paddingLeft: z.number().optional().describe("Left padding value"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({
      nodeId,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      channel,
    }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_padding",
          { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set padding for node ${nodeId}: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting padding: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Axis Align Tool
  server.tool(
    "set_axis_align",
    "Set primary and counter axis alignment for an auto-layout frame in Figma",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      primaryAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
        .optional()
        .describe(
          "Primary axis alignment (MIN/MAX = left/right in horizontal, top/bottom in vertical). Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."
        ),
      counterAxisAlignItems: z
        .enum(["MIN", "MAX", "CENTER", "BASELINE"])
        .optional()
        .describe(
          "Counter axis alignment (MIN/MAX = top/bottom in horizontal, left/right in vertical)"
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({
      nodeId,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      channel,
    }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_axis_align",
          { nodeId, primaryAxisAlignItems, counterAxisAlignItems },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set axis alignment for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting axis alignment: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Layout Sizing Tool
  server.tool(
    "set_layout_sizing",
    "Set horizontal and vertical sizing modes for an auto-layout frame in Figma",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      layoutSizingHorizontal: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe(
          "Horizontal sizing mode (HUG for frames/text only, FILL for auto-layout children only)"
        ),
      layoutSizingVertical: z
        .enum(["FIXED", "HUG", "FILL"])
        .optional()
        .describe(
          "Vertical sizing mode (HUG for frames/text only, FILL for auto-layout children only)"
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({
      nodeId,
      layoutSizingHorizontal,
      layoutSizingVertical,
      channel,
    }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_layout_sizing",
          { nodeId, layoutSizingHorizontal, layoutSizingVertical },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set layout sizing for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting layout sizing: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Item Spacing Tool
  server.tool(
    "set_item_spacing",
    "Set distance between children in an auto-layout frame",
    {
      nodeId: z.string().describe("The ID of the frame to modify"),
      itemSpacing: z
        .number()
        .optional()
        .describe(
          "Distance between children. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."
        ),
      counterAxisSpacing: z
        .number()
        .optional()
        .describe(
          "Distance between wrapped rows/columns. Only works when layoutWrap is set to WRAP."
        ),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeId, itemSpacing, counterAxisSpacing, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_item_spacing",
          { nodeId, itemSpacing, counterAxisSpacing },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set item spacing for node ${nodeId}: ${JSON.stringify(
                result
              )}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting item spacing: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Get Reactions Tool
  server.tool(
    "get_reactions",
    "Get Figma Prototyping Reactions from multiple nodes. CRITICAL: The output MUST be processed using the 'reaction_to_connector_strategy' prompt IMMEDIATELY to generate parameters for connector lines via the 'create_connections' tool.",
    {
      nodeIds: z
        .array(z.string())
        .describe("Array of node IDs to get reactions from"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ nodeIds, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "get_reactions",
          { nodeIds },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting reactions: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Set Default Connector Tool
  server.tool(
    "set_default_connector",
    "Set a copied connector node as the default connector",
    {
      connectorId: z
        .string()
        .optional()
        .describe("The ID of the connector node to set as default"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ connectorId, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "set_default_connector",
          { connectorId },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Set default connector: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting default connector: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Create Connections Tool
  server.tool(
    "create_connections",
    "Create connections between nodes using the default connector style",
    {
      connections: z
        .array(
          z.object({
            startNodeId: z.string().describe("ID of the starting node"),
            endNodeId: z.string().describe("ID of the ending node"),
            text: z
              .string()
              .optional()
              .describe("Optional text to display on the connector"),
          })
        )
        .describe("Array of node connections to create"),
      channel: z.string().describe("Channel to communicate with Figma plugin"),
    },
    async ({ connections, channel }: any) => {
      try {
        const result = await sendCommandToFigma(
          "create_connections",
          { connections },
          channel
        )
        return {
          content: [
            {
              type: "text",
              text: `Created connections: ${JSON.stringify(result)}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating connections: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        }
      }
    }
  )

  // Add prompts
  server.prompt(
    "design_strategy",
    "Best practices for working with Figma designs",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Figma Design Strategy

## Best Practices for Working with Figma Designs

### 1. Understanding Document Structure
- **Pages**: Figma documents contain pages, each with their own frames
- **Frames**: Main containers that can have auto-layout properties
- **Components**: Reusable design elements that can be instantiated
- **Styles**: Reusable color, text, and effect definitions

### 2. Node Hierarchy
- Every element in Figma is a node with a unique ID
- Nodes have parent-child relationships
- Understanding node types is crucial:
  - FRAME: Container with layout capabilities
  - TEXT: Text elements with typography properties
  - RECTANGLE: Basic shape with fill/stroke properties
  - COMPONENT: Master component definition
  - INSTANCE: Instance of a component

### 3. Auto-Layout Best Practices
- Use auto-layout frames for responsive designs
- Set proper spacing between elements using itemSpacing
- Choose appropriate sizing modes (FIXED, HUG, FILL)
- Align items using primaryAxisAlignItems and counterAxisAlignItems

### 4. Color Management
- Use RGBA values between 0-1 (not 0-255)
- Leverage color styles for consistency
- Consider accessibility when choosing colors

### 5. Typography
- Use semantic layer names for text nodes
- Maintain consistent font sizes and weights
- Consider text hierarchy in your designs

### 6. Component Strategy
- Create components for reusable elements
- Use instance overrides to customize instances
- Maintain a consistent component library

### 7. Organization
- Use meaningful names for all elements
- Group related elements in frames
- Maintain a clean layer structure`,
            },
          },
        ],
      }
    }
  )

  server.prompt(
    "read_design_strategy",
    "Best practices for reading Figma designs",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Reading Figma Designs Strategy

## Understanding Design Structure

When analyzing a Figma design, follow this systematic approach:

### 1. Start with Document Overview
Use \`get_document_info\` to understand:
- Document name and structure
- Available pages
- Overall organization

### 2. Understand Current Context
Use \`get_selection\` to see what's currently selected, then:
- Use \`read_my_design\` for detailed information about selected elements
- This gives you comprehensive node details including children

### 3. Navigate the Hierarchy
- Use \`get_node_info\` for specific nodes
- Use \`get_nodes_info\` for multiple nodes at once
- Understanding parent-child relationships is crucial

### 4. Analyze Components and Styles
- Use \`get_local_components\` to understand available components
- Use \`get_styles\` to see color, text, and effect styles
- This helps understand the design system

### 5. Scan for Specific Elements
- Use \`scan_text_nodes\` to find all text elements in a container
- Use \`scan_nodes_by_types\` to find specific node types
- This is efficient for content analysis

### 6. Color and Typography Analysis
- Read fill and stroke properties from node data
- Understand font families, sizes, and weights
- Note color values are in RGBA format (0-1)

### 7. Layout Understanding
- Identify auto-layout frames and their properties
- Understand spacing, alignment, and sizing modes
- Note how elements respond to content changes

### 8. Interactive Elements
- Use \`get_reactions\` to understand prototyping connections
- This reveals user flow and interaction patterns

## Reading Patterns

1. **Top-down**: Start with pages, then frames, then individual elements
2. **Component-first**: Identify components and their instances
3. **Content-focused**: Use scanning tools to find and analyze text/specific elements
4. **Interactive**: Understand user flows through reactions`,
            },
          },
        ],
      }
    }
  )

  server.prompt(
    "text_replacement_strategy",
    "Systematic approach for replacing text in Figma designs",
    (extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Text Replacement Strategy

## Systematic Approach for Updating Text Content in Figma

### 1. Identify Text Nodes
First, scan the design to find all text elements:
\`\`\`
Use scan_text_nodes with the container nodeId to get all text nodes
This returns: nodeId, text content, font properties, positioning
\`\`\`

### 2. Plan Replacements
Organize your text replacements:
- Map old text to new text
- Consider text length changes and their impact on layout
- Group related changes for batch processing

### 3. Execution Strategy

#### Single Text Updates
Use \`set_text_content\` for individual text nodes:
- Ideal for one-off changes
- Good for testing and verification

#### Batch Text Updates
Use \`set_multiple_text_contents\` for efficiency:
- Update multiple text nodes in parallel
- Faster for large-scale changes
- Maintains consistency

### 4. Layout Considerations
When replacing text content:
- **Auto-layout frames**: Will automatically adjust to new text length
- **Fixed frames**: May need manual resizing if text overflow occurs
- **Text wrapping**: Consider how longer text will wrap

### 5. Verification Process
After text replacement:
1. Use \`get_node_info\` to verify changes
2. Check that layout hasn't broken
3. Ensure text is still readable and well-positioned

### 6. Best Practices
- **Semantic naming**: Use meaningful layer names for text nodes
- **Consistent styling**: Maintain font properties when possible
- **Backup approach**: Document original text before changes
- **Iterative updates**: Start with small batches, then scale up

### 7. Common Patterns

#### Localization
- Replace all text with translated versions
- Consider text expansion in different languages
- Maintain text hierarchy and importance

#### Content Updates
- Update product names, descriptions, prices
- Maintain brand voice and formatting
- Consider SEO implications for web content

#### A/B Testing
- Create variations with different text
- Test different calls-to-action
- Measure impact of text changes`,
            },
          },
        ],
      }
    }
  )

  server.prompt(
    "annotation_conversion_strategy",
    "Strategy for converting manual annotations to Figma's native annotations",
    (args, extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Annotation Conversion Strategy

## Converting Manual Annotations to Figma Native Annotations

### Understanding Annotations
Figma's native annotation system provides structured, searchable, and collaborative annotation capabilities that are superior to manual text annotations.

### 1. Identify Manual Annotations
Look for:
- Text nodes containing annotation-like content
- Sticky notes or comment-style elements
- Documentation text separate from design content
- Version notes or specification text

### 2. Annotation Categories
Understand available annotation categories:
- **General**: Default annotations
- **Accessibility**: A11y notes and requirements
- **Development**: Technical implementation notes
- **Content**: Copy and content specifications
- **Custom categories**: Organization-specific categories

### 3. Conversion Process

#### Step 1: Scan for Annotation Candidates
\`\`\`
Use scan_text_nodes to find all text elements
Filter for annotation-like content:
- Text containing specifications
- Notes about functionality
- Development requirements
- Content guidelines
\`\`\`

#### Step 2: Categorize Annotations
Group similar annotations:
- Technical specifications → Development category
- Content requirements → Content category
- Accessibility notes → Accessibility category

#### Step 3: Create Native Annotations
Use \`set_annotation\` or \`set_multiple_annotations\`:
- Convert text content to labelMarkdown
- Assign appropriate categoryId
- Link to relevant design elements (nodeId)

### 4. Annotation Best Practices

#### Markdown Formatting
- Use **bold** for emphasis
- Use \`code\` for technical terms
- Use bullet points for lists
- Include links where relevant

#### Linking Strategy
- Attach annotations to the most relevant node
- Use component annotations for reusable elements
- Consider annotation inheritance

#### Content Guidelines
- Be concise but comprehensive
- Use consistent terminology
- Include context and rationale
- Reference external documentation when needed

### 5. Cleanup Process
After conversion:
1. Remove original manual annotation text nodes
2. Verify all annotations are properly linked
3. Test annotation visibility and searchability
4. Document the new annotation system for team

### 6. Team Adoption
- Train team on native annotation features
- Establish annotation conventions
- Create templates for common annotation types
- Set up review processes for annotation quality`,
            },
          },
        ],
      }
    }
  )

  server.prompt(
    "swap_overrides_instances",
    "Guide to swap instance overrides between instances",
    (args, extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Instance Override Swapping Strategy

## Understanding Component Instance Overrides

Instance overrides allow you to customize component instances while maintaining the connection to the master component. The override swapping feature lets you copy customizations from one instance and apply them to others.

### 1. What are Instance Overrides?
- Text content changes
- Image swaps
- Show/hide toggles
- Nested component swaps
- Fill color modifications
- Stroke modifications

### 2. Override Workflow

#### Step 1: Identify Source Instance
Find the instance with the desired customizations:
- Select the source instance manually, or
- Use \`get_selection\` to identify currently selected instance
- Document the source instance nodeId

#### Step 2: Extract Overrides
Use \`get_instance_overrides\`:
\`\`\`
get_instance_overrides(nodeId: sourceInstanceId, channel: channelName)
\`\`\`
This returns:
- sourceComponentKey: The component this instance is based on
- sourceComponentId: The master component ID
- sourceInstanceId: The source instance ID
- overrides: Array of all override properties
- success: Operation status
- message: Details about the operation

#### Step 3: Select Target Instances
Identify instances to receive the overrides:
- Use \`get_selection\` for currently selected instances
- Or specify target nodeIds directly
- Ensure targets are instances of compatible components

#### Step 4: Apply Overrides
Use \`set_instance_overrides\`:
\`\`\`
set_instance_overrides(
  sourceInstanceId: string,
  targetNodeIds: string[],
  channel: string
)
\`\`\`

### 3. Important Considerations

#### Component Compatibility
- Target instances will be swapped to match the source component
- This means they'll become instances of the same master component
- Original component connection will be lost

#### Override Types
The system handles these override types:
- **Text overrides**: Content changes in text layers
- **Fill overrides**: Color and pattern changes
- **Stroke overrides**: Border modifications
- **Nested instance overrides**: Component swaps within the instance
- **Visibility overrides**: Show/hide states

#### Batch Processing
- You can apply overrides to multiple instances at once
- This is efficient for updating similar elements
- Consider the impact on layout and design consistency

### 4. Use Cases

#### Design System Updates
- Create a "golden" instance with perfect styling
- Apply those overrides to all similar instances
- Maintain consistency across designs

#### Content Population
- Configure one instance with real content
- Apply to template instances
- Streamline content replacement workflows

#### A/B Testing Variations
- Create different instance variations
- Quickly swap between different configurations
- Test different design approaches

#### Responsive Design
- Configure instances for different screen sizes
- Apply responsive overrides to related instances
- Maintain design system integrity

### 5. Best Practices

#### Documentation
- Document which overrides are being applied
- Keep track of source instances for future reference
- Maintain override libraries for common patterns

#### Testing
- Test overrides on a small set first
- Verify layout and functionality after applying
- Check that all overrides applied correctly

#### Organization
- Use meaningful names for instances
- Group related instances for easier selection
- Maintain clear component hierarchies

#### Backup Strategy
- Save design state before major override operations
- Keep documentation of original configurations
- Plan rollback procedures if needed`,
            },
          },
        ],
      }
    }
  )

  server.prompt(
    "reaction_to_connector_strategy",
    "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
    (args, extra) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Reaction to Connector Conversion Strategy

## Converting Figma Prototype Reactions to Visual Connector Lines

### Understanding the Process
This strategy converts interactive prototype reactions (invisible connections) into visible connector lines that can be used for documentation, flowcharts, and visual communication of user flows.

### 1. Input Analysis
The \`get_reactions\` output contains:
\`\`\`json
{
  "reactions": [
    {
      "trigger": { /* trigger details */ },
      "actions": [
        {
          "type": "NODE",
          "destinationId": "target_node_id",
          "navigation": "NAVIGATE",
          "transition": { /* animation details */ }
        }
      ]
    }
  ],
  "nodes": {
    "source_node_id": { /* node details */ },
    "target_node_id": { /* node details */ }
  }
}
\`\`\`

### 2. Conversion Process

#### Step 1: Parse Reactions
Extract connection information:
- **Source Node**: The node with the reaction (trigger)
- **Target Node**: The destinationId in the action
- **Interaction Type**: Click, hover, etc.
- **Transition**: Navigation type and animation

#### Step 2: Generate Connection Parameters
Create connection objects for \`create_connections\`:
\`\`\`javascript
connections = reactions.map(reaction => ({
  startNodeId: reaction.sourceNodeId,
  endNodeId: reaction.actions[0].destinationId,
  text: generateConnectionLabel(reaction)
}))
\`\`\`

#### Step 3: Label Generation
Create meaningful labels based on:
- **Trigger type**: "On Click", "On Hover", "On Drag"
- **Navigation type**: "Navigate to", "Overlay", "Back"
- **Transition**: "Instant", "Slide", "Fade"

### 3. Label Strategies

#### Simple Labels
- "Click" for click triggers
- "Hover" for hover triggers
- "→" for simple navigation

#### Detailed Labels
- "Click → Screen 2"
- "Hover → Show Overlay"
- "Tap → Navigate Back"

#### Technical Labels
- "onClick: navigate('/screen2')"
- "onHover: overlay('modal')"
- "gesture: swipe_left"

### 4. Connection Filtering

#### Include Connections
- Navigation between screens
- Overlay presentations
- Modal displays
- State changes

#### Exclude Connections
- Self-referencing reactions
- Temporary animations
- Micro-interactions
- Invalid destinations

### 5. Connector Styling

#### Prerequisites
Before creating connections:
1. Copy or create a connector element
2. Use \`set_default_connector\` to establish the style
3. This connector will be used as a template

#### Style Considerations
- **Arrow style**: Indicates direction
- **Line weight**: Shows importance
- **Color**: Can indicate interaction type
- **Text styling**: Readable labels

### 6. Implementation Example

\`\`\`javascript
// Process get_reactions output
function processReactions(reactionsData) {
  const connections = [];
  
  reactionsData.reactions.forEach(reaction => {
    reaction.actions.forEach(action => {
      if (action.type === 'NODE' && action.navigation === 'NAVIGATE') {
        connections.push({
          startNodeId: reaction.sourceNodeId,
          endNodeId: action.destinationId,
          text: generateLabel(reaction.trigger, action)
        });
      }
    });
  });
  
  return connections;
}

function generateLabel(trigger, action) {
  const triggerText = trigger.type === 'ON_CLICK' ? 'Click' : 'Hover';
  return \`\${triggerText} → Navigate\`;
}
\`\`\`

### 7. Use Cases

#### User Flow Documentation
- Visualize complete user journeys
- Show decision points and paths
- Document interaction patterns

#### Developer Handoff
- Clarify interaction requirements
- Show navigation structure
- Specify transition types

#### Stakeholder Communication
- Make prototype interactions visible
- Explain user experience flow
- Facilitate design reviews

#### Design System Documentation
- Document interaction patterns
- Show component relationships
- Create pattern libraries

### 8. Quality Checks

#### Validation
- Ensure all source/target nodes exist
- Verify connections make logical sense
- Check for circular references

#### Layout
- Avoid overlapping connectors
- Ensure connectors don't obscure design
- Position labels clearly

#### Maintenance
- Update connectors when prototype changes
- Remove obsolete connections
- Keep documentation current`,
            },
          },
        ],
      }
    }
  )

  // Add more tools as needed...
  // (For brevity, I'm including just a few key tools. You can add more from your original server)

  return server
}

// Set up Express app with MCP server
async function setupServer() {
  const app = express()

  // Add CORS middleware
  app.use(
    cors({
      origin: "*", // Configure appropriately for production
      exposedHeaders: ["Mcp-Session-Id"],
      allowedHeaders: ["Content-Type", "mcp-session-id"],
    })
  )

  app.use(express.json())

  // Map to store transports by session ID
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {}

  // Handle POST requests for client-to-server communication
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined
    let transport: StreamableHTTPServerTransport

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId]
    } else if (!sessionId && req.body.method === "initialize") {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports[sessionId] = transport
        },
      })

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId]
        }
      }

      const server = createMcpServer()
      await server.connect(transport)
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      })
      return
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body)
  })

  // Handle GET requests for server-to-client notifications via SSE
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID")
      return
    }

    const transport = transports[sessionId]
    await transport.handleRequest(req, res)
  })

  // Handle DELETE requests for session termination
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID")
      return
    }

    const transport = transports[sessionId]
    await transport.handleRequest(req, res)
  })

  // Also provide backwards compatibility with SSE transport
  const sseTransports: { [sessionId: string]: SSEServerTransport } = {}

  // Legacy SSE endpoint for older clients
  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res)
    sseTransports[transport.sessionId!] = transport

    res.on("close", () => {
      if (transport.sessionId) {
        delete sseTransports[transport.sessionId]
      }
    })

    const server = createMcpServer()
    await server.connect(transport)
  })

  // Legacy message endpoint for older clients
  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string
    const transport = sseTransports[sessionId]
    if (transport) {
      await transport.handlePostMessage(req, res, req.body)
    } else {
      res.status(400).send("No transport found for sessionId")
    }
  })

  return app
}

// Start the server
async function main() {
  try {
    // Connect to Figma WebSocket server
    connectToFigma()

    // Set up Express server
    const app = await setupServer()

    const PORT = process.env.PORT || 3000
    app.listen(PORT, () => {
      logger.info(`MCP Remote Server listening on port ${PORT}`)
      logger.info(`Streamable HTTP endpoint: http://localhost:${PORT}/mcp`)
      logger.info(`Legacy SSE endpoint: http://localhost:${PORT}/sse`)
    })
  } catch (error) {
    logger.error(
      `Error starting MCP Remote Server: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    process.exit(1)
  }
}

// Run the server
main().catch((error) => {
  logger.error(
    `Error starting MCP Remote Server: ${
      error instanceof Error ? error.message : String(error)
    }`
  )
  process.exit(1)
})
