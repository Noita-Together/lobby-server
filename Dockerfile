FROM node:21-slim AS build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm install
COPY src/ ./src/
COPY tsconfig.json jest.config.js ./
# run tests
RUN npm test

# build
RUN npx tsup src/index.ts

# remove unnecessary dev/runtime dependencies
RUN npm prune --omit=dev

# remove unnecessary node bindings
ARG UWS_TARGET_LIB=uws_linux_x64_120.node
RUN find 'node_modules/uWebSockets.js' -name '*.node' -not -name "$UWS_TARGET_LIB" -delete

FROM node:21-slim

ARG UID=0
ARG GID=0

#RUN apk --no-cache add gcompat
RUN [ $GID -gt 0 ] && [ $UID -gt 0 ] \
    && addgroup -g $GID nginx \
    && adduser -G nginx -u $UID -h /noita-together -s /usr/sbin/nologin -D nginx \
    || true
USER $UID:$GID
WORKDIR /noita-together
COPY --chown=$UID:$GID --from=build /src/ ./

CMD ["node", "dist/index.js"]