import uWS, { us_listen_socket } from 'uWebSockets.js';

import { ClientAuth } from './runtypes/client_auth';
import { LobbyState } from './state/lobby';

import { createJwtFns } from './jwt';
import { createMessageHandler } from './ws_handlers';
import { BindPublishers } from './util';

import Debug from 'debug';
const debug = Debug('nt');

const asNumber = (v: unknown, dflt: number): number => {
  if (typeof v !== 'string') return dflt;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return n;
};

const TLS_KEY_FILE: string = process.env.TLS_KEY_FILE ?? '';
const TLS_CERT_FILE: string = process.env.TLS_CERT_FILE ?? '';
const TLS_SERVER_NAME: string = process.env.TLS_SERVER_NAME ?? '';
const USE_TLS = TLS_KEY_FILE !== '' && TLS_CERT_FILE !== '' && TLS_SERVER_NAME !== '';
const APP_LISTEN_ADDRESS = process.env.APP_LISTEN_ADDRESS ?? '0.0.0.0';
const APP_LISTEN_PORT = asNumber(process.env.APP_PORT, 4444);
const WS_PATH = process.env.WS_PATH ?? '/ws';
const API_PATH = process.env.API_PATH ?? '/api';
const APP_UNIX_SOCKET = process.env.APP_UNIX_SOCKET ?? '';

const app = USE_TLS ? uWS.SSLApp({}) : uWS.App();

const publishers = BindPublishers(app);
const lobby = new LobbyState(publishers, process.env.DEV_MODE === 'true');

const JWT_SECRET = process.env.JWT_SECRET ?? null;
const JWT_REFRESH = process.env.JWT_REFRESH ?? null;

if (!JWT_SECRET || !JWT_REFRESH) {
  console.error('JWT_SECRET and JWT_REFRESH are required environment variables');
  process.exit(1);
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

if (USE_TLS) {
  const appOptions = {
    key_file_name: TLS_KEY_FILE,
    cert_file_name: TLS_CERT_FILE,
  };
  app.addServerName(TLS_SERVER_NAME, appOptions);
  const reload = () => {
    console.log('Received SIGHUP, reloading certificates');
    app.removeServerName(TLS_SERVER_NAME);
    app.addServerName(TLS_SERVER_NAME, appOptions);
  };
  process.on('SIGHUP', reload);
}

(USE_TLS ? app.domain(TLS_SERVER_NAME) : app)
  .ws<ClientAuth>(`${WS_PATH}/:token`, {
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
    res.writeStatus('200 OK').end();
  })
  .get(`${API_PATH}/stats/:roomid/:statsid`, (res, req) => {
    const roomId = req.getParameter(0);
    const statsId = req.getParameter(1);

    const jsonStr = lobby.getStats(roomId, statsId);

    if (!jsonStr) {
      res.writeStatus('404 Not Found').end();
      return;
    }

    res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json; charset=utf-8').end(jsonStr);
  });

const onListen = (host: string) => (token: any) => {
  const pid = process.pid;
  console.log(`[${pid}] Listening for websocket connections on ${USE_TLS ? 'wss' : 'ws'}://${host}${WS_PATH}`, token);
  console.log(`[${pid}] Listening for HTTP connections on ${USE_TLS ? 'https' : 'http'}://${host}${API_PATH}`, token);
  listen_sockets.push(token);
};

if (APP_UNIX_SOCKET) {
  app.listen_unix(onListen(`[unix:${APP_UNIX_SOCKET}]`), APP_UNIX_SOCKET);
} else {
  app.listen(APP_LISTEN_ADDRESS, APP_LISTEN_PORT, onListen(`${APP_LISTEN_ADDRESS}:${APP_LISTEN_PORT}`));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
