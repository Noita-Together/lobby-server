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

# run tests
COPY jest.config.js .
RUN npx jest

# build
RUN npx tsup src/index.ts

# remove unnecessary dev/runtime dependencies
RUN npm prune --omit=dev
RUN find 'node_modules/uWebSockets.js' -name '*.node' -not -name "$UWS_TARGET_LIB" -delete

FROM node:20-alpine

ARG UID=0
ARG GID=0

RUN apk --no-cache add gcompat
RUN [ $GID -gt 0 ] && [ $UID -gt 0 ] \
    && addgroup -g $GID nginx \
    && adduser -G nginx -u $UID -h /noita-together -s /usr/sbin/nologin -D nginx \
    || true
USER $UID:$GID
WORKDIR /noita-together
COPY --chown=$UID:$GID --from=build /src/ ./

CMD ["node", "dist/index.js"]
