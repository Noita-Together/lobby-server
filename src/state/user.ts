import { WebSocket } from 'uWebsockets.js';

import * as NT from '../gen/messages_pb';
import { M, Publishers } from '../util';
// import { recordPublish, recordSend, recordSubscribe, recordUnsubscribe } from '../record';

import { RoomState } from './room';
import { LobbyState } from './lobby';

import Debug from 'debug';
const debug = Debug('nt:user');

export interface IUser {
  readonly id: string;
  readonly name: string;

  lastX: number;
  lastY: number;
}

const uaccess = new Map<string, number>([
  ['SkyeOfBreeze', 3],
  ['kabbypls', 3],
  ['DunkOrSlam', 3],
  ['myndzi', 3],
]);

const distSquaredThreshold = 400 * 400;

export class UserState implements IUser {
  public readonly id: string;
  public readonly name: string;
  public readonly uaccess: number;

  public readonly lastX = 0;
  public readonly lastY = 0;

  // rooms can hang on to a UserState reference even if the user is disconnected. writing to
  // a stale websocket is an error, so we store a UserState with no socket as this.socket = null
  private socket: WebSocket<unknown> | null;
  private currentRoom: RoomState | null;
  private readyState: NT.ClientReadyState;

  constructor({ id, name }: { id: string; name: string }, socket: WebSocket<unknown>) {
    this.id = id;
    this.name = name;
    this.uaccess = uaccess.get(name) ?? 0;

    this.socket = socket;
    this.currentRoom = null;
    this.readyState = new NT.ClientReadyState();
  }

  setLast(x: number, y: number) {
    (this as IUser).lastX = x;
    (this as IUser).lastY = y;
  }

  isNear(other: UserState) {
    return (other.lastX - this.lastX) ** 2 + (other.lastY - this.lastY) ** 2 < distSquaredThreshold;
  }

  mods(): string {
    return JSON.stringify(this.readyState.mods) ?? '';
  }

  withSocket<
    Arg extends unknown,
    Args extends Arg[],
    T extends (...args: [...Args, WebSocket<unknown> | undefined]) => any,
  >(fn: T, ...args: Args) {
    if (this.socket) fn(...args, this.socket);
  }

  room() {
    return this.currentRoom;
  }

  isReady() {
    return this.readyState.ready;
  }

  isConnected() {
    return this.socket !== null;
  }

  send(message: Uint8Array | NT.Envelope) {
    const ret = this.socket?.send(message instanceof Uint8Array ? message : message.toBinary(), true, false);
    // if (ret !== undefined) recordSend(this.id, message, ret);
  }

  broadcast(topic: string, message: Uint8Array | NT.Envelope) {
    const ret = this.socket?.publish(topic, message instanceof Uint8Array ? message : message.toBinary(), true, false);
    // if (ret !== undefined) recordPublish(this.id, topic, message, ret);
  }

  updateReadyState(payload: NT.ClientReadyState) {
    debug(this.id, this.name, 'readystate updated', {
      ready: payload.ready,
      seed: payload.seed,
      mods: payload.mods?.length,
    });

    this.readyState = payload;
    if (this.currentRoom) this.currentRoom.onUserReadyStateChange(this, payload);
  }

  joined(room: RoomState) {
    this.currentRoom = room;
    const ret = this.socket?.subscribe(room.topic);
    // if (ret !== undefined) recordSubscribe(this.id, room.topic, ret);

    this.send(M.sJoinRoomSuccess(room.getState()));
    this.send(room.getFlags());
  }

  parted(room: RoomState) {
    debug('unsubscribe', room.topic);
    setImmediate(() => {
      // temp hax: unsubscribe after receiving broadcast messages
      const ret = this.socket?.unsubscribe(room.topic);
      // if (ret !== undefined) recordUnsubscribe(this.id, room.topic, ret);
    });
    this.currentRoom = null;

    // TODO:
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
  connected(ws: WebSocket<unknown>, lobby: LobbyState) {
    debug(this.id, this.name, 'connected');
    this.socket = ws;

    // TODO / BUG : uWS fails to send messages to a socket on a topic when
    // that topic is unsubscribed in the same tick and the socket is not
    // subscribed to any further topics. see https://github.com/uNetworking/uWebSockets.js/issues/976
    // for now, we _do_ want to be subscribed to the lobby, and being subscribed
    // to the lobby "just happens to" work around the bug, maybe. the known
    // symptom of the bug taking effect is trying to leave a lobby in the NT
    // app and having an infinite spinner, due to not receiving the confirmation
    // message.
    const ret = ws.subscribe(lobby.topic);
    // recordSubscribe(this.id, lobby.topic, ret);
  }
  reconnected(ws: WebSocket<unknown>, lobby: LobbyState) {
    debug(this.id, this.name, 'reconnected');
    this.connected(ws, lobby);

    // TODO: NT app only listens for join room events after it has sent a request to join
    // a room, so we can't forcibly put the user back in the lobby in their UI.
    //
    // it also implicitly sets state such as "isHost" and can't seem to adopt the world seed
    // flag when a disconnected user rejoins, so... i give up for now.
    //
    // what the old server does is destroy any rooms owned by the user if they try to create
    // a different one, but reimplementing that behavior with clean state tracking is troublesome
    // so we'll destroy it when they reconnect instead for now.

    // if (this.currentRoom) this.joined(this.currentRoom);

    // temp hax: reproduce existing behavior (destroy current room on create)
    // if (this.currentRoom) {
    //   if (this.currentRoom.owner === this) {
    //     this.currentRoom.destroy();
    //   } else {
    //     this.parted(this.currentRoom);
    //   }
    // }
  }

  destroy() {
    this.socket = null;
  }
}
