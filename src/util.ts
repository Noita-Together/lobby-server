import { createHmac, randomBytes } from 'node:crypto';
import { TemplatedApp, WebSocket } from 'uWebSockets.js';
import { v4 as uuidv4 } from 'uuid';
import { M, NT } from 'nt-message';

import { IUser } from './state/user';

import Debug from 'debug';
const debug = Debug('nt:util');

type HasPublish = Pick<WebSocket<unknown>, 'publish'>;

/**
 * Returns a set of factory functions for publishing to specific topics on the uWS app
 */
export const BindPublishers = (app: TemplatedApp, createChatId: () => string = uuidv4) => {
  const publish = (topic: string, message: Uint8Array | NT.Envelope, target: HasPublish = app) => {
    target.publish(topic, message instanceof Uint8Array ? message : NT.Envelope.encode(message).finish(), true, false);
  };

  return {
    broadcast: (topic: string) => (message: Uint8Array | NT.Envelope, socket?: HasPublish) =>
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
