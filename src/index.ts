import UWS from 'uWebsockets.js';

import * as NT from './gen/messages_pb';
import { ClientAuth } from './runtypes/client_auth';
import { LobbyState } from './state/lobby';
import { UserState } from './state/user';
import { RoomState } from './state/room';

import { verifyToken } from './jwt';
import { BindPublishers } from './util';
// import { recordReceive } from './record';

import Debug from 'debug';
const debug = Debug('nt');

const WS_KEY_FILE: string = '';
const WS_CERT_FILE: string = '';
const WS_SECURE = WS_KEY_FILE !== '' && WS_CERT_FILE !== '';
const WS_HOST = '0.0.0.0';
const WS_PORT = 4444;
const WS_PATH = '/ws';

const users = new WeakMap<UWS.WebSocket<ClientAuth>, UserState>();
const app = WS_SECURE
  ? UWS.SSLApp({
      key_file_name: WS_KEY_FILE,
      cert_file_name: WS_CERT_FILE,
    })
  : UWS.App();
const publishers = BindPublishers(app);
const lobby = new LobbyState(publishers);

app
  .ws<ClientAuth>(`${WS_PATH}/:token`, {
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
      const user = lobby.userConnected(ws);
      users.set(ws, user);
    },
    close: (ws, code, message) => {
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

      const msg = NT.Envelope.fromBinary(new Uint8Array(message));

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
        debug('Caught error from handler', actionType, action, e);
      }
    },
  })
  .listen(WS_HOST, WS_PORT, (token) => {
    console.log(`Listening on ${WS_SECURE ? 'wss' : 'ws'}://${WS_HOST}:${WS_PORT}${WS_PATH}`, token);
  });