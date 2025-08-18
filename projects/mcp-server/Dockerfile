# Use the Node.js 24 image as the base image
FROM node:24-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package files and npm config
COPY package*.json .npmrc ./

# Copy the source code (needed for prepare script)
COPY . .

# Install all dependencies (prepare script will build automatically)
RUN npm ci

# Remove devDependencies to reduce image size
RUN npm prune --omit=dev


# Expose the port on which the MCP API will listen
EXPOSE 3000

# Run the remote MCP server when the container launches
CMD ["node", "dist/remote-server.js"]
