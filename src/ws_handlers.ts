import { HttpRequest, HttpResponse, WebSocket, us_socket_context_t } from 'uWebSockets.js';

import { ClientAuth } from './runtypes/client_auth';

import { LobbyState } from './state/lobby';
import { UserState } from './state/user';
import { RoomState } from './state/room';

import { maybePlayerMove } from './protoutil';

import * as NT from './gen/messages_pb';

import type Debug from 'debug';
import { shortHash } from './util';

let conn_id = 0;

export type TaggedClientAuth = {
  conn_id: number;
} & ClientAuth;
export type ClientAuthWebSocket = Pick<
  WebSocket<TaggedClientAuth>,
  'getUserData' | 'send' | 'publish' | 'subscribe' | 'unsubscribe' | 'close' | 'end'
>;

/**
 * Returns a set of state and functions used to implement the uWebSockets TemplatedApp interface.
 *
 * Abstracted here to enable direct testing of these functions without having to wrangle a bunch
 * of sockets.
 */
export const createMessageHandler = ({
  verifyToken,
  lobby,
  debug,
}: {
  verifyToken: (token: string) => Promise<ClientAuth>;
  lobby: LobbyState;
  debug: Debug.Debugger;
}) => {
  const sockets = new Set<ClientAuthWebSocket>();
  const users = new WeakMap<ClientAuthWebSocket, UserState>();

  const trycatch =
    <Arg extends unknown, Args extends Arg[]>(label: string, fn: (...args: Args) => void) =>
    (...args: Args) => {
      try {
        return fn(...args);
      } catch (e) {
        debug(`${label}: caught unexpected error`, e);
      }
    };

  const handleUpgrade = trycatch('handleUpgrade', (res: HttpResponse, req: HttpRequest, ctx: us_socket_context_t) => {
    const thisConnId = conn_id++;

    const ip = shortHash(req.getHeader('x-forwarded-for') || Buffer.from(res.getRemoteAddressAsText()).toString());
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
          res.upgrade(
            { conn_id: thisConnId, ...clientAuth },
            secWebSocketKey,
            secWebSocketProtocol,
            secWebSocketExtensions,
            ctx,
          );
        });
      })
      .catch((err) => {
        debug(ip, 'upgrade failed: ' + err.message);
        res.cork(() => {
          res.writeStatus('401 Unauthorized').end();
        });
      });
  });

  const handleOpen = trycatch('handleOpen', (ws: ClientAuthWebSocket) => {
    sockets.add(ws);
    const user = lobby.userConnected(ws);
    users.set(ws, user);
  });

  const handleMessage = trycatch(
    'handleMessage',
    (ws: ClientAuthWebSocket, message: ArrayBuffer, isBinary: boolean) => {
      const user = users.get(ws);
      if (!user) {
        console.error('BUG: userState not present in weakmap');
        return;
      }

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
  );

  const handleClose = trycatch('handleClose', (ws: ClientAuthWebSocket, code: number, message: ArrayBuffer) => {
    debug('handleClose', ws.getUserData().conn_id);
    sockets.delete(ws);
    const user = users.get(ws);
    if (!user) {
      console.error('BUG: userState not present in weakmap');
      return;
    }
    user.withSocket((socket) => {
      if (!socket) return;
      debug('user current socket', socket.getUserData().conn_id);
      // call userDisconnected only if the socket being closed is this
      // UserState instance's active connection. otherwise, let it close silently.
      if (socket === ws) lobby.userDisconnected(user, code, message);
    });
  });

  return { sockets, users, handleUpgrade, handleOpen, handleClose, handleMessage };
};
