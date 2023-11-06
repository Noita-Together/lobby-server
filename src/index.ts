import uWS, { WebSocket, us_listen_socket } from 'uWebsockets.js';

import * as NT from './gen/messages_pb';
import { ClientAuth } from './runtypes/client_auth';
import { LobbyState } from './state/lobby';
import { UserState } from './state/user';
import { RoomState } from './state/room';

import { verifyToken } from './jwt';
import { BindPublishers } from './util';
// import { recordReceive } from './record';
import { ProtoHax } from './protohax/protohax';
import { Envelope, GameAction } from './gen/messages_pb';

import Debug from 'debug';
import { maybePlayerMove } from './protoutil';
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

const users = new WeakMap<uWS.WebSocket<ClientAuth>, UserState>();
const app = WS_SECURE
  ? uWS.SSLApp({
      key_file_name: WS_KEY_FILE,
      cert_file_name: WS_CERT_FILE,
    })
  : uWS.App();
const publishers = BindPublishers(app);
const lobby = new LobbyState(publishers);
const sockets = new Set<WebSocket<unknown>>();

const gameAction = Envelope.fields.findJsonName('gameAction')!.no;
const playerMove = GameAction.fields.findJsonName('playerMove')!.no;

app.ws<ClientAuth>(`${WS_PATH}/:token`, {
  upgrade: (res, req, ctx) => {
    const ip = req.getHeader('x-forwarded-for') || Buffer.from(res.getRemoteAddressAsText()).toString();
    debug(ip, 'upgrade request');

    // See https://github.com/uNetworking/uWebSockets.js/blob/master/examples/UpgradeAsync.js
    // there are some specific requirements that must be met to do this asynchronously!
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');

    let aborted = false;

    // NT app connects to wss?://host:port/<path>/<JWT>
    const token = decodeURIComponent(req.getParameter(0));

    verifyToken(token)
      .then((clientAuth) => {
        const user = `${clientAuth.sub}:${clientAuth.preferred_username}`;
        if (aborted) {
          console.error('Client disconnected before websocket upgrade completed');
          debug(ip, clientAuth.sub, clientAuth.preferred_username, 'disconnected before handshake completed');
          return;
        }

        debug(ip, clientAuth.sub, clientAuth.preferred_username, 'upgrade success');
        // "cork" is weirdly named, but essentially means to bundle potentially multiple
        // syscalls into a single operation
        res.cork(() => {
          res.upgrade(clientAuth, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, ctx);
        });
      })
      .catch((err) => {
        debug(ip, 'upgrade failed: ' + err.message);
        res.cork(() => {
          res.writeStatus('401 Unauthorized').end();
        });
      });
  },
  open: (ws) => {
    sockets.add(ws);
    const user = lobby.userConnected(ws);
    users.set(ws, user);
  },
  close: (ws, code, message) => {
    sockets.delete(ws);
    const user = users.get(ws);
    if (!user) {
      console.error('BUG: userState not present in weakmap');
      return;
    }
    lobby.userDisconnected(user, code, message);
  },
  message: (ws, message, isBinary) => {
    const user = users.get(ws);
    if (!user) {
      console.error('BUG: userState not present in weakmap');
      return;
    }

    // recordReceive(user.id, message);

    // optimized message handling for player move updates
    const buf = Buffer.from(message);
    const playerMovePayload = maybePlayerMove(buf);

    if (playerMovePayload) {
      user.room()?.playerMoveRaw(playerMovePayload, user);
      return;
    }

    // fall back to proper decode/encode for everything else
    const msg = NT.Envelope.fromBinary(buf);

    // debug(user.name, msg.kind.case, msg.kind.value?.action.case);

    const { case: actionType, value: actionPayload } = msg.kind;
    if (!actionType || !actionPayload) return; // empty "kind"

    const { case: action, value: payload } = actionPayload.action;
    if (!action || !payload) return; // empty "action"

    let target: LobbyState | RoomState | null = null;
    switch (actionType) {
      case 'lobbyAction':
        target = lobby;
        break;
      case 'gameAction':
        target = user.room();
        break;
    }

    try {
      if (target && action) {
        const method = (target as any)[action];
        if (typeof method === 'function') method.call(target, payload, user);
      }
    } catch (e) {
      console.error('Caught error from handler', actionType, action, e);
      // debug('Caught error from handler', actionType, action, e);
    }
  },
});

const listen_sockets: us_listen_socket[] = [];

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

let count = 0;
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
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
