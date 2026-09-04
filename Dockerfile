FROM node:20-slim

# Install ffmpeg, curl, ca-certificates, python3, unzip for yt-dlp + deno
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    curl \
    ca-certificates \
    python3 \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install deno (JS runtime untuk yt-dlp YouTube extraction)
RUN curl -fsSL https://deno.land/install.sh | sh && mv /root/.deno/bin/deno /usr/local/bin/deno && deno --version

# Install standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy dependency definition
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build Vite frontend & Node server
RUN npm run build

# Create storage directories
RUN mkdir -p storage/downloads storage/renders storage/uploads storage/audio_assets storage/cache

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
