# Use Node.js 24 as the base image
FROM node:24

# Set the working directory in the container
WORKDIR /app

# Install Bun
RUN npm install -g bun

# Copy the current directory contents into the container at /app
COPY package*.json ./

RUN bun install

# Copy the source code
COPY . .

# Expose the port on which the API will listen
EXPOSE 3055

# Run the server when the container launches
CMD ["bun", "socket.ts"]
