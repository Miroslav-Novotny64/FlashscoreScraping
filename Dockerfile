FROM mcr.microsoft.com/playwright:v1.56.1-jammy

# Set the working directory
WORKDIR /app

# Set environment to production and define REST API port
ENV NODE_ENV=production
ENV PORT=8080

# Copy node configurations
COPY package*.json ./

# Install dependencies using clean install
RUN npm ci

# Copy the rest of the application files
COPY . .

# Expose the port our HTTP server will run on
EXPOSE 8080

# Start up using the npm script hook
CMD ["npm", "start"]
