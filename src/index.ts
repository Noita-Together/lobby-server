import uWS, { us_listen_socket } from 'uWebSockets.js';

import { ClientAuth } from './runtypes/client_auth';
import { LobbyState } from './state/lobby';

import { createJwtFns } from './jwt';
import { createMessageHandler } from './ws_handlers';
import { BindPublishers } from './util';
// import { recordReceive } from './record';

import Debug from 'debug';
const debug = Debug('nt');

const asNumber = (v: unknown, dflt: number): number => {
  if (typeof v !== 'string') return dflt;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return n;
};

const WS_KEY_FILE: string = process.env.WS_KEY_FILE ?? '';
const WS_CERT_FILE: string = process.env.WS_CERT_FILE ?? '';
const WS_SECURE = WS_KEY_FILE !== '' && WS_CERT_FILE !== '';
const WS_HOST = process.env.WS_HOST ?? '0.0.0.0';
const WS_PORT = asNumber(process.env.WS_PORT, 4444);
const WS_PATH = process.env.WS_PATH ?? '/ws';
const WS_UNIX_SOCKET = process.env.WS_UNIX_SOCKET ?? '';

const app = WS_SECURE
  ? uWS.SSLApp({
      key_file_name: WS_KEY_FILE,
      cert_file_name: WS_CERT_FILE,
    })
  : uWS.App();

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

app.ws<ClientAuth>(`${WS_PATH}/:token`, {
  idleTimeout: 120,
  sendPingsAutomatically: true,
  maxLifetime: 0,
  maxPayloadLength: 16 * 1024 * 1024,
  upgrade: handleUpgrade,
  open: handleOpen,
  close: handleClose,
  message: handleMessage,
});

if (WS_UNIX_SOCKET) {
  app.listen_unix((token) => {
    console.log(`Listening on ${WS_SECURE ? 'wss' : 'ws'}://[unix:${WS_UNIX_SOCKET}]${WS_PATH}`, token);
    listen_sockets.push(token);
  }, WS_UNIX_SOCKET);
} else {
  app.listen(WS_HOST, WS_PORT, (token) => {
    console.log(`Listening on ${WS_SECURE ? 'wss' : 'ws'}://${WS_HOST}:${WS_PORT}${WS_PATH}`, token);
    listen_sockets.push(token);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
