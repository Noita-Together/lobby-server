import { Message } from '@bufbuild/protobuf';
import { M } from '../util';

import { WebSocket } from 'uWebsockets.js';
import { RoomState } from './room';
import * as NT from '../gen/messages_pb';
import { LobbyState } from './lobby';

import Debug from 'debug';
const debug = Debug('nt:user');

export interface IUser {
  readonly id: string;
  readonly name: string;
}

export class UserState implements IUser {
  public readonly id: string;
  public readonly name: string;
  public readonly uaccess: number;

  // rooms can hang on to a UserState reference even if the user is disconnected. writing to
  // a stale websocket is an error, so we store a UserState with no socket as this.socket = null
  private socket: WebSocket<unknown> | null;
  private lobby: LobbyState;
  private currentRoom: RoomState | null;
  private readyState: NT.ClientReadyState;

  constructor(lobby: LobbyState, { id, name }: { id: string; name: string }, socket: WebSocket<unknown>) {
    this.id = id;
    this.name = name;
    this.uaccess = 0;

    this.socket = socket;
    this.lobby = lobby;
    this.currentRoom = null;
    this.readyState = new NT.ClientReadyState();
  }

  room() {
    return this.currentRoom;
  }

  isReady() {
    return this.readyState.ready;
  }

  send(message: Uint8Array | Message<any>) {
    this.socket?.send(message instanceof Uint8Array ? message : message.toBinary(), true, false);
  }

  updateReadyState(payload: NT.ClientReadyState) {
    debug(this.id, this.name, 'readystate updated', {
      ready: payload.ready,
      seed: payload.seed,
      mods: payload.mods?.length,
    });
    this.readyState = payload;
  }

  joined(room: RoomState) {
    this.currentRoom = room;
    this.socket?.subscribe(room.topic);

    this.send(M.sJoinRoomSuccess(room.getState({ withUsers: true, withPassword: true })));
    // COMPATIBILITY: how does NT app deal with receiving (possibly empty) flags?
    // it _should_ keep its defaults and make no changes, but PB handling has proven
    // incorrect in protobufjs
    this.send(room.getFlags());
  }

  parted(room: RoomState) {
    this.socket?.unsubscribe(room.topic);
    this.currentRoom = null;

    // from old code:
    // this.position = { x: 0, y: 0 }
    // this.cacheReady = null
    // this.modCheck = null
    // this.room = null
  }

  disconnected() {
    debug(this.id, this.name, 'disconnected');
    this.socket = null;
  }
  connected(ws: WebSocket<unknown>) {
    debug(this.id, this.name, 'connected');
    this.socket = ws;
  }
  reconnected(ws: WebSocket<unknown>) {
    debug(this.id, this.name, 'reconnected');
    this.connected(ws);

    // TODO: send this user their room status
  }

  destroy() {
    this.socket = null;
  }
}
