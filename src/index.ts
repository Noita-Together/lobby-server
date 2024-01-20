import uWS, { us_listen_socket } from 'uWebSockets.js';

import { LobbyState } from './state/lobby';

import { createJwtFns } from './jwt';
import { TaggedClientAuth, createMessageHandler } from './ws_handlers';
import { BindPublishers } from './util';
import {
  API_PATH,
  APP_LISTEN_ADDRESS,
  APP_LISTEN_PORT,
  APP_UNIX_SOCKET,
  DEV_MODE,
  JWT_REFRESH,
  JWT_SECRET,
  TLS_CERT_FILE,
  TLS_KEY_FILE,
  TLS_SERVER_NAME,
  USE_TLS,
  WEBFACE_ORIGIN,
  WS_PATH,
  assertEnvRequirements,
} from './env_vars';

import Debug from 'debug';
const debug = Debug('nt');

const app = USE_TLS ? uWS.SSLApp({}) : uWS.App();

const publishers = BindPublishers(app);
const lobby = new LobbyState(publishers, DEV_MODE);

if (require.main === module) {
  assertEnvRequirements();
}

const { verifyToken } = createJwtFns(JWT_SECRET, JWT_REFRESH);

const { handleOpen, handleClose, handleUpgrade, handleMessage, sockets } = createMessageHandler({
  verifyToken,
  lobby,
  debug,
});

let count = 0;
const listen_sockets: us_listen_socket[] = [];
const shutdown = () => {
  if (count++ > 0) {
    console.log('Forcibly terminating');
    process.exit(1);
  } else {
    console.log('Shutting down');
  }

  listen_sockets.forEach((token) => uWS.us_listen_socket_close(token));
  listen_sockets.length = 0;

  sockets.forEach((socket) => socket.close());
};

const setCorsHeaders = (res: uWS.HttpResponse) => {
  res.writeHeader('Access-Control-Allow-Origin', WEBFACE_ORIGIN);
  res.writeHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.writeHeader('Access-Control-Allow-Headers', 'origin, content-type, accept, x-requested-with');
  res.writeHeader('Access-Control-Max-Age', '3600');
};

const bindHandlers = (serverName?: string) =>
  (serverName ? app.domain(serverName) : app)
    .ws<TaggedClientAuth>(`${WS_PATH}/:token`, {
      idleTimeout: 120,
      sendPingsAutomatically: true,
      maxLifetime: 0,
      maxPayloadLength: 16 * 1024 * 1024,
      upgrade: handleUpgrade,
      open: handleOpen,
      close: handleClose,
      message: handleMessage,
    })
    .get(`${API_PATH}/health`, (res) => {
      const jsonStr = JSON.stringify(lobby.getInfo());
      setCorsHeaders(res);
      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json; charset=utf-8').end(jsonStr);
    })
    .get(`${API_PATH}/stats/:roomid/:statsid`, (res, req) => {
      setCorsHeaders(res);
      const roomId = req.getParameter(0);
      const statsId = req.getParameter(1);

      const jsonStr = lobby.getStats(roomId, statsId);

      if (!jsonStr) {
        res.writeStatus('404 Not Found').end();
        return;
      }

      res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json; charset=utf-8').end(jsonStr);
    })
    .options(`${API_PATH}/*`, (res, req) => {
      setCorsHeaders(res);
      res.end();
    });

const onListen = (host: string) => (token: any) => {
  const pid = process.pid;
  console.log(`[${pid}] Listening for websocket connections on ${USE_TLS ? 'wss' : 'ws'}://${host}${WS_PATH}`, token);
  console.log(`[${pid}] Listening for HTTP connections on ${USE_TLS ? 'https' : 'http'}://${host}${API_PATH}`, token);
  listen_sockets.push(token);
};

if (USE_TLS) {
  const appOptions = {
    key_file_name: TLS_KEY_FILE,
    cert_file_name: TLS_CERT_FILE,
  };

  app.addServerName(TLS_SERVER_NAME, appOptions);
  bindHandlers(TLS_SERVER_NAME);

  const reload = () => {
    console.log('Received SIGHUP, reloading certificates');
    app.removeServerName(TLS_SERVER_NAME);
    app.addServerName(TLS_SERVER_NAME, appOptions);
    bindHandlers(TLS_SERVER_NAME);
  };

  process.on('SIGHUP', reload);
} else {
  bindHandlers();
}

if (APP_UNIX_SOCKET) {
  app.listen_unix(onListen(`[unix:${APP_UNIX_SOCKET}]`), APP_UNIX_SOCKET);
} else {
  app.listen(APP_LISTEN_ADDRESS, APP_LISTEN_PORT, onListen(`${APP_LISTEN_ADDRESS}:${APP_LISTEN_PORT}`));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGQUIT', () => {
  lobby.drain(60 * 60 * 1000).then(shutdown);
});
