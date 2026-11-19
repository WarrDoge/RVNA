FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
ENV NODE_ENV=production
ENV PORT=3000
ENV BODY_SIZE_LIMIT=250M
ENV MAX_UPLOAD_REQUEST_MB=250
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
RUN mkdir -p /app/data/attachments && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "build"]
