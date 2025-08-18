# Use the Node.js 24 image as the base image
FROM node:24-alpine

# Set the working directory in the container
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files
COPY package*.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy the source code
COPY . .

# Build the project
RUN pnpm run build


# Expose the port on which the MCP API will listen
EXPOSE 3000

# Run the remote MCP server when the container launches
CMD ["node", "dist/remote-server.js"]
