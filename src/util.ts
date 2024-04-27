import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TemplatedApp, WebSocket } from 'uWebSockets.js';
import { v4 as uuidv4 } from 'uuid';
import { M, NT } from '@noita-together/nt-message';

import { IUser } from './state/user';

import Debug from 'debug';
import { RoomTracker } from './room_tracker';
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

export const makeDeferred = (cb?: () => void) => {
  const deferred: {
    resolve: (value: void | PromiseLike<void>) => void;
    reject: (reason?: any) => void;
    promise: Promise<void>;
  } = {} as any;
  deferred.promise = new Promise<void>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  }).then(cb);
  return deferred;
};
export type Deferred = ReturnType<typeof makeDeferred>;

export const formatDuration = (durationMs: number) => {
  const units = [
    // { label: 'year', seconds: 31_536_000_000 },
    // { label: 'month', seconds: 2_592_000_000 },
    // { label: 'day', seconds: 86_400_000 },
    { label: 'hour', seconds: 3_600_000 },
    { label: 'minute', seconds: 60_000 },
    // { label: 'second', seconds: 1_000 },
  ];

  for (const unit of units) {
    const unitCount = Math.round(durationMs / unit.seconds);
    if (unitCount > 0) return `${unitCount} ${unit.label}${unitCount > 1 ? 's' : ''}`;
  }
  return 'moments';
};

export const formatBytes = (bytes: number) => {
  const units = [
    { label: 'GiB', bytes: 1024 ** 3 },
    { label: 'MiB', bytes: 1024 ** 2 },
    { label: 'KiB', bytes: 1024 },
  ];

  for (const unit of units) {
    const unitCount = bytes / unit.bytes;
    if (unitCount >= 1) return `${unitCount.toFixed(2)} ${unit.label}`;
  }
  return `${bytes.toFixed(2)} B`;
};

export const randomRoomName = (() => {
  const load = (filename: string) =>
    readFileSync(resolve(__dirname, 'wordlists', filename), 'utf-8')
      .split(/[\r\n]+/)
      .filter((v) => !!v);

  const spells = load('allspells-beta.txt');
  const perks = load('allperks-beta.txt');

  const rt = new RoomTracker([spells, perks]);
  return (userSuppliedName: string | null) => rt.acquire(userSuppliedName);
})();
