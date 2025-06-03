# Use an official Node.js runtime as a parent image
FROM node:18-alpine As builder
WORKDIR /usr/src/app

RUN apk add --no-cache git

COPY package*.json ./

# Install app dependencies
# Use 'npm ci' for faster, more reliable installs in CI/CD environments
RUN npm ci --only=production

# Copy app source code
COPY . .

# --- Release Stage ---
FROM node:18-alpine

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=7000

# Expose port 7000
EXPOSE 7000

# Command to run the application
CMD [ "npm", "run", "prod" ]
