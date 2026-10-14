# Base image
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy all other project files
COPY . .

# Expose the port your backend runs on (usually 5000 or 3000)
# Make sure your server.js uses process.env.PORT
EXPOSE 5000

# Command to run the application
CMD ["npm", "start"]
