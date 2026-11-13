# GRIT Interview Scheduling: Next.js 16 on Node 24 (native TypeScript for migrate/seed).
FROM node:24-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The DB client checks DATABASE_URL at import time; the build doesn't connect.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN DATABASE_URL="$DATABASE_URL" npm run build

ENV NODE_ENV=production
EXPOSE 3000
# Applies pending migrations, then serves on $PORT.
CMD ["npm", "run", "start:prod"]
