# Use the Node.js 24 image as the base image
FROM node:24-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package files and npm config
COPY package*.json .npmrc ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy the source code
COPY . .

# Build the project
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --omit=dev


# Expose the port on which the MCP API will listen
EXPOSE 3000

# Run the remote MCP server when the container launches
CMD ["node", "dist/remote-server.js"]
