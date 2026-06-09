FROM node:24-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the API source.
COPY src ./src

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
