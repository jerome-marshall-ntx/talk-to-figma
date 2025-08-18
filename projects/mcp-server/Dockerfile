# Use the Bun image as the base image
FROM oven/bun:latest

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY package*.json ./

RUN bun install

# Copy the source code
COPY . .

# Build the project
RUN bun run build

# Expose the port on which the MCP API will listen
EXPOSE 3000

# Run the remote MCP server when the container launches
CMD ["node", "dist/remote-server.js"]
