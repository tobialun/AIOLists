FROM node:18-alpine as builder
WORKDIR /usr/src/app

RUN apk add --no-cache git
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ # <--- ADD THIS LINE

COPY package*.json ./
RUN npm ci --omit=dev # Changed to --omit=dev as per npm warning

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
