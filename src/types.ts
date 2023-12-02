import { Message } from 'protobufjs';
import { NT } from './gen/pbjs_pb';
import type { UserState } from './state/user';

export interface ActionCreator<T> {
  (data: Exclude<T, undefined | null>, encoded: true): Uint8Array;
  (data: Exclude<T, undefined | null>, encoded: false): NT.Envelope;
  (data: Exclude<T, undefined | null>): NT.Envelope;
}

export type GameActionCreators = {
  [K in keyof NT.IGameAction]-?: ActionCreator<NT.IGameAction[K]>;
};
export type LobbyActionCreators = {
  [K in keyof NT.ILobbyAction]-?: ActionCreator<NT.ILobbyAction[K]>;
};

type Simplify<T> = { [K in keyof T]: T[K] } & unknown;

export type MessageInstance<T extends object> = Message<T> & T;

export type DecodedHandlers<T extends string> = {
  [K in T]: (payload: any, user: UserState) => void;
};
export type RawHandlers<T extends string> = {
  [K in T]: (payload: Buffer, user: UserState) => void;
};

type GAH = keyof NT.IGameAction & `c${string}`;
export type GameActionHandlers<RawKeys extends GAH = never> = Simplify<
  DecodedHandlers<Exclude<GAH, RawKeys>> & RawHandlers<RawKeys>
>;

type LAH = keyof NT.ILobbyAction & `c${string}`;
export type LobbyActionHandlers<RawKeys extends LAH = never> = Simplify<
  DecodedHandlers<Exclude<LAH, RawKeys>> & RawHandlers<RawKeys>
>;

// type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
// type Simplify<U> = { [K in keyof U]: U[K] } & unknown;
// type MessageType<T extends Message<any>> = T extends Message<infer P> ? P : never;

// export type Handler<T extends Message<any>> = (payload: MessageType<T>, user: UserState) => void;

// export type Handlers<U extends { case: string; value: Message<any> }> = Simplify<
//   UnionToIntersection<
//     U extends { case: infer C extends `c${string}`; value: infer M extends Message<any> }
//       ? { [K in C]: Handler<M> }
//       : never
//   >
// >;

// export type LobbyActions = Exclude<NT.LobbyAction['action'], undefined | { case: undefined; value?: undefined }>;
// export type LobbyActionNames = LobbyActions['case'] & `c${string}`;
// export type GameActions = Exclude<NT.GameAction['action'], undefined | { case: undefined; value?: undefined }>;
// export type GameActionNames = GameActions['case'] & `c${string}`;

// export const isClientLobbyAction = (v: unknown): v is LobbyActionNames => typeof v === 'string' && v.startsWith('c');
// export const isClientGameAction = (v: unknown): v is GameActionNames => typeof v === 'string' && v.startsWith('c');
