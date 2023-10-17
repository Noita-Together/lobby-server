import UWS from 'uWebsockets.js';
import * as NT from './gen/messages_pb';

import { basename } from 'node:path';
import { verifyToken } from './jwt';
import { ClientAuth } from './runtypes/client_auth';
import { LobbyState } from './state/lobby';
import { UserState } from './state/user';
import { BindPublishers } from './util';

const users = new WeakMap<UWS.WebSocket<ClientAuth>, UserState>();

const app = UWS.App();
const publishers = BindPublishers(app);
const lobby = new LobbyState(publishers);

app
  .ws<ClientAuth>('/ws/*', {
    upgrade: (res, req, ctx) => {
      console.log('upgrade');
      const url = req.getUrl();
      const secWebSocketKey = req.getHeader('sec-websocket-key');
      const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
      const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');

      let aborted = false;
      const token = decodeURIComponent(basename(url));

      verifyToken(token)
        .then((clientAuth) => {
          if (aborted) {
            console.error('Client disconnected before websocket upgrade completed');
            return;
          }

          // "cork" is weirdly named, but essentially means to bundle potentially multiple
          // syscalls into a single operation
          res.cork(() => {
            res.upgrade(clientAuth, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, ctx);
          });
        })
        .catch((err) => {
          res.cork(() => {
            res.writeStatus('401 Unauthorized').end();
          });
        });
    },
    open: (ws) => {
      const user = new UserState(ws);
      users.set(ws, user);

      lobby.addUser(user);
      ws.subscribe(lobby.topic);

      console.log(`open: ${user.name}`);
    },
    close: (ws, code, message) => {
      const user = users.get(ws);
      users.delete(ws);

      let username: string;

      if (user) {
        lobby.delUser(user);

        user.destroy();
        users.delete(ws);

        username = user.name;
      } else {
        const clientAuth = ws.getUserData();
        username = clientAuth.preferred_username;
        console.error('BUG: userState not present in weakmap');
      }

      console.log(`${username} disconnected: code=${code} message=${Buffer.from(message).toString()}`);
    },
    message: (ws, message, isBinary) => {
      const user = users.get(ws);
      if (!user) {
        console.error('BUG: userState not present in weakmap');
        return;
      }

      const msg = NT.Envelope.fromBinary(new Uint8Array(message));

      const { case: actionType, value: actionPayload } = msg.kind;
      if (!actionType || !actionPayload) return; // empty "kind"

      const { case: action, value: payload } = actionPayload.action;
      if (!action || !payload) return; // empty "action"

      console.log('message', actionType, action);

      switch (actionType) {
        case 'lobbyAction':
          const method = (lobby as any)[action];
          if (typeof method === 'function') method.call(lobby, payload, user);
      }
    },
  })
  .listen('0.0.0.0', 4444, (token) => {
    console.log('Listen callback', token);
  });
