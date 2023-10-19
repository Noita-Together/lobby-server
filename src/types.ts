import type { Message } from '@bufbuild/protobuf';

import * as NT from './gen/messages_pb';
import type { UserState } from './state/user';

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type Simplify<U> = { [K in keyof U]: U[K] } & unknown;
type MessageType<T extends Message<any>> = T extends Message<infer P> ? P : never;

export type Handler<T extends Message<any>> = (payload: MessageType<T>, user: UserState) => void;

export type Handlers<U extends { case: string; value: Message<any> }> = Simplify<
  UnionToIntersection<
    U extends { case: infer C extends `c${string}`; value: infer M extends Message<any> }
      ? { [K in C]: Handler<M> }
      : never
  >
>;

export type LobbyActions = Exclude<NT.LobbyAction['action'], undefined | { case: undefined; value?: undefined }>;
export type LobbyActionNames = LobbyActions['case'] & `c${string}`;
export type GameActions = Exclude<NT.GameAction['action'], undefined | { case: undefined; value?: undefined }>;
export type GameActionNames = GameActions['case'] & `c${string}`;

export const isClientLobbyAction = (v: unknown): v is LobbyActionNames => typeof v === 'string' && v.startsWith('c');
export const isClientGameAction = (v: unknown): v is GameActionNames => typeof v === 'string' && v.startsWith('c');
