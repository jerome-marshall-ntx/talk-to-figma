# Use Node.js 18 LTS as the base image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy the TypeScript source code
COPY . .

# Build the project
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm ci --only=production && npm cache clean --force

# Expose the port on which the API will listen
EXPOSE 3055

# Run the server when the container launches
CMD ["npm", "start"]
