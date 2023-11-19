import { TemplatedApp, WebSocket } from 'uWebSockets.js';
import { AnyMessage, PlainMessage } from '@bufbuild/protobuf';
import { v4 as uuidv4 } from 'uuid';

import { IUser } from './state/user';
import { Envelope, GameAction, LobbyAction } from './gen/messages_pb';

import { GameActions, LobbyActions } from './types';

import { createHmac, randomBytes } from 'node:crypto';

import Debug from 'debug';
const debug = Debug('nt:util');

type LobbyActionCreator = {
  [K in LobbyActions['case']]: (LobbyActions & { case: K })['value'];
};
type GameActionCreator = {
  [K in GameActions['case']]: (GameActions & { case: K })['value'];
};

type Creators<T extends PlainMessage<AnyMessage>> = {
  [K in keyof T]: (data?: PlainMessage<T[K]>) => Envelope;
} & unknown;

/**
 * Factory functions for each action type. Each function
 * accepts an action payload and returns an `Envelope` instance
 *
 * @example
 * ```ts
 * M.cChat({ message: 'hi there' })
 * ```
 */
export const M: Creators<LobbyActionCreator & GameActionCreator> = {} as any;

for (const f of GameAction.fields.list()) {
  if (f.kind !== 'message' || f.oneof?.name !== 'action') continue;
  (M as any)[f.jsonName] = (data: PlainMessage<AnyMessage> | undefined) =>
    new Envelope({
      kind: {
        case: 'gameAction',
        value: {
          action: {
            case: f.jsonName as any,
            value: new f.T(data) as any,
          },
        },
      },
    });
}

for (const f of LobbyAction.fields.list()) {
  if (f.kind !== 'message' || f.oneof?.name !== 'action') continue;
  (M as any)[f.jsonName] = (data: PlainMessage<AnyMessage> | undefined) =>
    new Envelope({
      kind: {
        case: 'lobbyAction',
        value: {
          action: {
            case: f.jsonName as any,
            value: new f.T(data) as any,
          },
        },
      },
    });
}

type HasPublish = Pick<WebSocket<unknown>, 'publish'>;

/**
 * Returns a set of factory functions for publishing to specific topics on the uWS app
 */
export const BindPublishers = (app: TemplatedApp, createChatId: () => string = uuidv4) => {
  const publish = (topic: string, message: Uint8Array | Envelope, target: HasPublish = app) => {
    target.publish(topic, message instanceof Uint8Array ? message : message.toBinary(), true, false);
  };

  return {
    broadcast: (topic: string) => (message: Uint8Array | Envelope, socket?: HasPublish) =>
      publish(topic, message, socket),
    chat: (topic: string) => (user: IUser, message: string, socket?: HasPublish) =>
      publish(
        topic,
        M.sChat({
          id: createChatId(),
          userId: user.id,
          name: user.name,
          message,
        }),
        socket,
      ),
  };
};

/**
 * Factory function for creating chat message payloads
 */
export const createChat =
  (createChatId: () => string = uuidv4) =>
  (user: IUser, message: string) =>
    M.sChat({
      id: createChatId(),
      userId: user.id,
      name: user.name,
      message,
    });

export type Publishers = ReturnType<typeof BindPublishers>;

/**
 * Takes an input string and hashes it with a session-unique HMAC key.
 * Returns a 16-character base64 string from the first 12 bytes of the result.
 *
 * Primarily used to hash IP addresses for logging: the output should not
 * be reversible, but it should be consistent when the input is the same.
 */
export const shortHash = (() => {
  const key = randomBytes(256 / 8);
  return (ip: string): string => createHmac('sha256', key).update(ip).digest().subarray(0, 12).toString('base64');
})();
