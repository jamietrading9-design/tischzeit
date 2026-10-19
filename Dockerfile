FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && mkdir -p /var/lib/tischzeit \
  && chown -R node:node /app /var/lib/tischzeit

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV DATABASE_PATH=/var/lib/tischzeit/tischzeit.sqlite

USER node
EXPOSE 3001

CMD ["npm", "start"]
