import { Message } from '@bufbuild/protobuf';

import { WebSocket } from 'uWebsockets.js';
import { ClientAuth } from '../runtypes/client_auth';
import { RoomState } from './room';
import * as NT from '../gen/messages_pb';
import { LobbyState } from './lobby';

export interface IUser {
  readonly id: string;
  readonly name: string;
}

export class UserState implements IUser {
  public readonly id: string;
  public readonly name: string;
  public readonly uaccess: number = 0;

  private socket: WebSocket<ClientAuth>;
  private currentRoom: RoomState | null = null;
  private readyState: NT.ClientReadyState;

  constructor(socket: WebSocket<ClientAuth>) {
    this.socket = socket;

    const user = socket.getUserData();

    this.id = user.sub;
    this.name = user.preferred_username;
    this.readyState = new NT.ClientReadyState();
  }

  room() {
    return this.currentRoom;
  }

  isReady() {
    return this.readyState.ready;
  }

  send(message: Uint8Array | Message<any>): number {
    return this.socket.send(message instanceof Uint8Array ? message : message.toBinary(), true, false);
  }

  updateReadyState(payload: NT.ClientReadyState) {
    this.readyState = payload;
  }

  join(room: RoomState) {
    this.currentRoom = room;
    this.socket.subscribe(room.topic);
    room.joined(this); // after subscribe, so the user can receive the room status messages
  }

  part() {
    if (!this.currentRoom) return;

    this.socket.unsubscribe(this.currentRoom.topic);
    this.currentRoom.parted(this);
  }

  kickFrom(room: RoomState) {
    this.socket.unsubscribe(room.topic);
    room.parted(this);
  }

  banFrom(room: RoomState) {
    this.socket.unsubscribe(room.topic);
    room.banned(this);
  }

  roomAdmin(cb: (room: RoomState) => string | void, getMessage?: (reason: string) => Message<any>): void {
    if (!this.currentRoom) {
      if (getMessage) this.send(getMessage("Room doesn't exist."));
      return;
    }

    if (this.currentRoom.owner !== this) {
      if (getMessage) this.send(getMessage("Can't do that."));
      return;
    }

    const error = cb(this.currentRoom);
    if (error && getMessage) this.send(getMessage(error));
  }

  init(lobby: LobbyState) {
    this.socket.subscribe(lobby.topic);
  }

  destroy() {
    this.currentRoom?.disconnected(this);
  }
}
