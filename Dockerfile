FROM node:20-alpine AS build

ARG UWS_TARGET_LIB=uws_linux_x64_115.node

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm install
COPY buf.gen.yaml .
COPY proto/ ./proto/
RUN npx buf generate proto
COPY tsconfig.json .
COPY src/ ./src/
RUN npx tsup src/index.ts
RUN npm prune --omit=dev
RUN find 'node_modules/uWebsockets.js' -name '*.node' -not -name "$UWS_TARGET_LIB" -delete

FROM node:20-alpine

WORKDIR /noita-together
RUN apk --no-cache add gcompat
COPY --from=build /src/ ./

CMD ["node", "dist/index.js"]
