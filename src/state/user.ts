import * as NT from '../gen/messages_pb';
import { M } from '../util';

import { RoomState } from './room';
import { LobbyState } from './lobby';
import { ClientAuthWebSocket } from '../ws_handlers';

import Debug from 'debug';
import { RecognizedString } from 'uWebSockets.js';
const debug = Debug('nt:user');

export interface IUser {
  readonly id: string;
  readonly name: string;
}

// TODO: read this from disk like before
const uaccess = new Map<string, number>([
  ['SkyeOfBreeze', 3],
  ['kabbypls', 3],
  ['DunkOrSlam', 3],
  ['myndzi', 3],
]);

let instanceId = 0;

/**
 * Represents the state of a user in an NT lobby
 */
export class UserState implements IUser {
  public readonly id: string;
  public readonly name: string;
  public readonly uaccess: number;

  public readonly lastX = 0;
  public readonly lastY = 0;

  // rooms can hang on to a UserState reference even if the user is disconnected. writing to
  // a stale websocket is an error, so we store a UserState with no socket as this.socket = null
  private socket: ClientAuthWebSocket | null;
  private currentRoom: RoomState | null;
  private readyState: NT.ClientReadyState;

  readonly playerIdBuf: Buffer; // just don't modify this
  readonly instanceId: number;

  constructor({ id, name }: { id: string; name: string }, socket: ClientAuthWebSocket) {
    this.instanceId = instanceId++;
    this.id = id;
    this.name = name;
    this.uaccess = uaccess.get(name) ?? 0;

    this.socket = socket;
    this.currentRoom = null;
    this.readyState = new NT.ClientReadyState();

    this.playerIdBuf = Buffer.from(id);
  }

  /**
   * Get the list of mods as of this user's most recent readyState update.
   * Used for verifying the mods haven't changed between room joins, to
   * automatically start the game for reconnected users.
   */
  mods(): string {
    return JSON.stringify(this.readyState.mods);
  }

  /**
   * "Unhide" this user's socket temporarily, allowing a caller to
   * interact with it directly within the confines of the callback.
   *
   * Bad abstraction, revisit.
   *
   * @param fn Callback
   * @param args Callback args
   */
  withSocket<
    Arg extends unknown,
    Args extends Arg[],
    T extends (...args: [...Args, ClientAuthWebSocket | undefined]) => any,
  >(fn: T, ...args: Args) {
    if (this.socket) fn(...args, this.socket);
  }

  /**
   * Return the RoomState object representing the room in which this user
   * is currently present. `null` if the user is not in a room.
   */
  room() {
    return this.currentRoom;
  }

  /**
   * Get the user's `ready` state as of the most recent readyState update.
   */
  isReady() {
    return this.readyState.ready;
  }

  /**
   * Return `true` if the user is connected (has a socket), `false` if not.
   */
  isConnected() {
    return this.socket !== null;
  }

  /**
   * Sends a message directly to the user.
   *
   * @param message The Envelope, or encoded Envelope, to send
   */
  send(message: Uint8Array | NT.Envelope) {
    this.socket?.send(message instanceof Uint8Array ? message : message.toBinary(), true, false);
  }

  /**
   * Broadcast a message to the given topic, excluding this user.
   *
   * @param topic The topic to which the message is published
   * @param message The Envelope, or encoded Envelope, to send
   */
  broadcast(topic: string, message: Uint8Array | NT.Envelope) {
    this.socket?.publish(topic, message instanceof Uint8Array ? message : message.toBinary(), true, false);
  }

  /**
   * Store a received readyState payload on this user's state and
   * notify the user's room, if any.
   */
  updateReadyState(payload: NT.ClientReadyState) {
    debug(this.id, this.name, 'readystate updated', {
      ready: payload.ready,
      seed: payload.seed,
      mods: payload.mods?.length,
    });

    this.readyState = payload;
    if (this.currentRoom) this.currentRoom.onUserReadyStateChange(this, payload);
  }

  /**
   * Called after a user has joined a room
   *
   * @param room RoomState instance that was joined
   * @param wasCreate `true` if the user joined due to creating the room
   */
  joined(room: RoomState, wasCreate: boolean = false) {
    this.currentRoom = room;
    this.socket?.subscribe(room.topic);

    if (!wasCreate) {
      this.send(M.sJoinRoomSuccess(room.getState()));
      this.send(room.getFlags());
    }
    for (const user of room.getUsers()) {
      if (this === user) continue;
      this.send(M.sUserReadyState({ userId: user.id, ...user.readyState }));
    }
  }

  /**
   * Called after a user has left (or been removed from) a room
   *
   * @param room RoomState instance the user left
   */
  parted(room: RoomState) {
    debug('unsubscribe', room.topic);
    this.socket?.unsubscribe(room.topic);
    this.currentRoom = null;
    this.readyState = new NT.ClientReadyState();
  }

  /**
   * Called after a user has been disconnected
   */
  disconnected() {
    debug(this.id, this.name, 'disconnected');
    this.socket = null;
  }

  /**
   * Called after a user has connected
   *
   * @param ws WebSocket instance associated with this user
   * @param lobby LobbyState instance that the user connected to
   */
  connected(ws: ClientAuthWebSocket, lobby: LobbyState) {
    debug(this.id, this.name, 'connected');
    this.socket = ws;
    ws.subscribe(lobby.topic);
  }

  /**
   * Called after a user has reconnected
   *
   * @param ws WebSocket instance associated with this user
   * @param lobby LobbyState instance that the user connected to
   */
  reconnected(ws: ClientAuthWebSocket, lobby: LobbyState) {
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
  }

  /**
   * Gracefully clean up this UserState instance. Called from the websocket close handler, but
   * may also be called from business logic to close the socket from the server side of things.
   */
  destroy(code?: number, shortMessage?: RecognizedString) {
    const socket = this.socket;

    // uWS synchronously calls the close handler when the _server_ closes the connection, but doesn't inform us
    // of the difference. we want to notify the UserState instance that the socket was closed by the client, but
    // not recursively notify it when the server initiated the close. therefore, we must set the socket reference
    // to null _before_ calling socket.end(), which will let us check and ignore the close event in the handler.
    this.socket = null;

    if (socket !== null) {
      debug('destroying socket', { instanceId: this.instanceId, connId: socket.getUserData().conn_id });
      socket.end(code, shortMessage);
    }
  }
}
