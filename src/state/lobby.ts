import * as NT from '../gen/messages_pb';
import { Handlers, LobbyActions } from '../types';
import { ClientAuthWebSocket } from '../ws_handlers';
import { Publishers, M } from '../util';

import { IUser, UserState } from './user';
import { RoomState } from './room';

export const SYSTEM_USER: IUser = { id: '-1', name: '[SYSTEM]', lastX: 0, lastY: 0 };
export const ANNOUNCEMENT: IUser = { id: '-2', name: '[ANNOUNCEMENT]', lastX: 0, lastY: 0 };

import Debug from 'debug';
const debug = Debug('nt:lobby');

type Simplify<T> = { [K in keyof T]: T[K] } & unknown;
type createRoomParams = Simplify<Omit<Parameters<typeof RoomState.create>[0], 'roomId'>>;

export class LobbyState implements Handlers<LobbyActions> {
  private readonly publishers: Publishers;
  readonly broadcast: ReturnType<Publishers['broadcast']>;

  readonly topic = 'lobby';

  private rooms = new Map<string, RoomState>();
  private users = new Map<string, UserState>();

  constructor(
    publishers: Publishers,
    private devMode: boolean,
    private createRoomId?: () => string,
    private createChatId?: () => string,
  ) {
    this.publishers = publishers;
    this.broadcast = publishers.broadcast(this.topic);
  }

  userConnected(ws: ClientAuthWebSocket): UserState {
    // rooms retain a reference to the UserState of their owner and any users present in the room.
    // if the user gets disconnected, we don't want to destroy the room (and possibly kick everybody
    // out if it was the host that disconnected) -- we want them to be able to reconnect and pick up
    // where they left off. however, we have no guarantee they are coming back, either. in order to
    // allow a reconnecting user to "adopt" their previous state, when a user gets disconnected, and
    // only if they were in a room, we'll keep a reference from the user's id to the room's id. when
    // a user connects, if the room they used to be in still exists, we'll find their old state and
    // communicate it back to them. if it does not exist, we can create a new UserState.
    //
    // TODO: make electron app gracefully close the websocket, so we know the difference between
    // the user intentionally exiting and getting disconnected unexpectedly
    //
    // TODO: we can clean up dangling rooms after they've been dead for a certain amount of time,
    // and should have some information communicated on the RoomState to describe rooms that have
    // no connected host.

    const { sub: id, preferred_username: name } = ws.getUserData();

    // TODO: what happens if a user launches multiple clients?
    let user: UserState | undefined = this.users.get(id);

    // this is a bit hairy, but:
    // - if a user is disconnected while in a room, their UserState remains in our map
    // - if a user is disconnected while not in a room, we deleted their entry
    // - if a user who was previously disconnected reconnects, and their room is
    //   still active, we want to rejoin them to the room
    // - if a user who was previously disconnected reconnects, and their room has
    //   since been destroyed, their "currentRoom" property will be null. we want
    //   to start them fresh, so even though we have them in the map, we'll ignore
    //   that entry, create a fresh one, overwrite that entry, and the old object
    //   will get garbage-collected
    if (user && user.room() !== null) {
      debug(id, name, 'reconnected');
      user.reconnected(ws, this);
    } else {
      debug(id, name, 'connected');
      user = new UserState({ id, name }, ws);
      user.connected(ws, this);
    }
    this.users.set(user.id, user);

    return user;
  }

  userDisconnected(user: UserState, code: number, message: ArrayBuffer) {
    debug(user.id, user.name, 'disconnected', code, Buffer.from(message).toString());
    // TODO: NT app needs to send a graceful exit so we can tell the difference between
    // a quit and a disconnect. pick that up at the uWS app layer (websocket close code?)
    // and communicate it here.

    // if the user is not in a room, we can safely clean them up
    const room = user.room();

    if (room) {
      user.disconnected();

      // if the user _is_ in a room, we'll leave them in the list in case
      // they reconnect. if this user was the last active user in a room,
      // we'll destroy the entire room.
      this.gc(room);
    } else {
      this.users.delete(user.id);
      user.destroy();
    }
  }

  private gc(room: RoomState) {
    // we could use bookkeeping to keep a count of connected users per room to
    // avoid the work of enumerating the connected-state of all users in the room,
    // but that is precise work and we don't expect the amount of effort here to
    // be significantly impactful.

    for (const user of room.getUsers()) {
      // so long as any user in the room is connected, the room is alive; return early
      if (user.isConnected()) return;
    }

    debug(room.id, 'destroyed room: no connected users');
    // no users in the room are connected, destroy it
    room.destroy();
  }

  roomDestroyed(room: RoomState) {
    this.rooms.delete(room.id);
  }

  private createRoom(params: createRoomParams): RoomState | void {
    return RoomState.create({
      ...params,
      ...(this.createRoomId ? { roomId: this.createRoomId() } : {}),
      ...(this.createChatId ? { createChatId: this.createChatId } : {}),
    });
  }

  //// message handlers ////

  cRoomCreate(payload: NT.ClientRoomCreate, user: UserState) {
    const room = this.createRoom({
      lobby: this,
      owner: user,
      opts: {
        locked: false,
        ...payload,
      },
      publishers: this.publishers,
      devMode: this.devMode,
    });

    if (room) {
      this.rooms.set(room.id, room);
      user.broadcast(this.topic, M.sRoomAddToList({ room: room.getState() }));
    }
  }

  cRoomDelete(payload: NT.ClientRoomDelete, user: UserState) {
    // while the payload specifies a room, the (previous) server's behavior
    // was to infer it from the room that the user is a member of, so the
    // payload is explicitly ignored.
    user.room()?.delete(user);
  }

  cRoomUpdate(payload: NT.ClientRoomUpdate, user: UserState) {
    const reason = user.room()?.update(user, payload);
    if (reason) user.send(M.sRoomUpdateFailed({ reason }));
  }

  cRoomFlagsUpdate(payload: NT.ClientRoomFlagsUpdate, user: UserState) {
    const reason = user.room()?.setFlags(user, payload);
    if (reason) user.send(M.sRoomFlagsUpdateFailed({ reason }));
  }

  cJoinRoom(payload: NT.ClientJoinRoom, user: UserState) {
    const room = this.rooms.get(payload.id);
    if (!room) {
      user.send(M.sJoinRoomFailed({ reason: "Room doesn't exist." }));
    } else {
      room.join(user, payload.password);
    }
  }
  cLeaveRoom(_: NT.ClientLeaveRoom, user: UserState) {
    // when the room owner leaves the room, a cRoomDelete message is sent
    // _instead of_ cLeaveRoom
    user.room()?.part(user);
  }
  cKickUser(payload: NT.ClientKickUser, user: UserState) {
    if (this.users.has(payload.userId)) {
      user.room()?.kick(user, this.users.get(payload.userId)!);
    }
  }
  cBanUser(payload: NT.ClientBanUser, user: UserState) {
    if (this.users.has(payload.userId)) {
      user.room()?.ban(user, this.users.get(payload.userId)!);
    }
  }
  cReadyState(payload: NT.ClientReadyState, user: UserState) {
    user.updateReadyState(payload);
    // user.broadcast(this.topic, M.sUserReadyState({ userId: user.id, ...payload }));
  }
  cStartRun(payload: NT.ClientStartRun, user: UserState) {
    user.room()?.startRun(user, payload);
    // this.broadcast(M.sHostStart({ forced: false }));
  }
  cRequestRoomList(payload: NT.ClientRequestRoomList, user: UserState) {
    user.send(
      M.sRoomList({
        pages: 0, // not implemented
        rooms: [...this.rooms.values()].map((room) => room.getState()),
      }),
    );
  }
  cRunOver(payload: NT.ClientRunOver, user: UserState) {
    user.room()?.finishRun(user);
  }
}
