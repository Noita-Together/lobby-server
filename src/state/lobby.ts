import { M, NT } from '@noita-together/nt-message';
import { ClientAuthWebSocket } from '../ws_handlers';
import { Publishers } from '../util';
import { LobbyActionHandlers } from '../types';

import { IUser, UserState } from './user';
import { RoomState, RoomStateUpdateOpts } from './room';
import { RoomName } from '../room_tracker';

export const SYSTEM_USER: IUser = { id: '-1', name: '[SYSTEM]' };
export const ANNOUNCEMENT: IUser = { id: '-2', name: '[ANNOUNCEMENT]' };

import Debug from 'debug';
const debug = Debug('nt:lobby');

type Simplify<T> = { [K in keyof T]: T[K] } & unknown;
type createRoomParams = Simplify<Omit<Parameters<typeof RoomState.create>[0], 'roomId'>>;

/**
 * Represents the state of an NT lobby. Currently there is exactly one lobby per
 * running instance.
 */
export class LobbyState implements LobbyActionHandlers {
  private readonly publishers: Publishers;
  readonly broadcast: ReturnType<Publishers['broadcast']>;

  readonly topic = 'lobby';

  private rooms = new Map<string, RoomState>();
  private users = new Map<string, UserState>();

  private isDraining = false;

  /**
   * Construct a new Lobby
   *
   * @param publishers Set of functions for broadcasting messages to users in this lobby. Bad abstraction - fix.
   * @param devMode When `true`, only users with dev access may create rooms
   * @param createRoomId Used only for testing
   * @param createChatId Used only for testing
   */
  constructor(
    publishers: Publishers,
    private devMode: boolean,
    private createRoomId?: () => string,
    private createChatId?: () => string,
    private createStatsId?: () => string,
    private createRoomName?: (userSuppliedName: string | null) => RoomName,
  ) {
    this.publishers = publishers;
    this.broadcast = publishers.broadcast(this.topic);
  }

  /**
   * Return the number of rooms and users present in the lobby.
   *
   * Note: users may be disconnected but still represented here,
   * so long as they are included in a room with at least one
   * connected user.
   */
  getInfo() {
    return {
      rooms: this.rooms.size,
      users: this.users.size,
    };
  }

  /**
   * Returns a promise that resolves when all rooms have drained
   *
   * TODO: create a proto state-change message or something, add a banner to the app.
   * For now we'll just broadcast a chat message to all rooms.
   */
  drain(inMs: number): Promise<void[]> {
    this.isDraining = true;
    return Promise.all([...this.rooms.values()].map((room) => room.drain(inMs)));
  }

  /**
   * Responsible for handling reconnection logic. Returns either a
   * previously-present UserState instance or a new one.
   *
   * @param ws WebSocket associated with the connected user
   */
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

    const { sub: id, preferred_username: name } = ws.getUserData();

    // TODO: should we support multiple clients?
    // - in the new proto proposal, each user has a lobby id that is distinct
    //   from their authenticated/twitch id. this would allow mulitple instances
    //   of the same "real" user to be kept separate and not conflict.
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

    if (user) {
      // if there was an existing user, destroy its socket and subscriptions
      user.destroy(1011, 'Connection superseded');
    }

    if (user && user.room() !== null) {
      debug(id, name, 'reconnected');
      user.reconnected(ws, this);
    } else {
      debug(id, name, 'connected');
      user = new UserState({ id, name }, ws);
      user.connected(ws, this);
    }

    // additional debug info - verify whether the userstate identity changed,
    // and whether the socket is the same or not
    user.withSocket((socket) => {
      debug({ id, name, instanceId: user!.instanceId, connId: socket?.getUserData().conn_id ?? null });
    });

    this.users.set(user.id, user);

    return user;
  }

  /**
   * Called when a user disconnects. Cleans up empty rooms, and destroys
   * the UserState instance if nothing cares.
   *
   * @param user UserState instance of the user that disconnected
   * @param code WebSocket close code
   * @param message Optional (frequently empty) close reason
   */
  userDisconnected(user: UserState, code: number, message: ArrayBuffer) {
    debug(user.id, user.name, 'disconnected', code, Buffer.from(message).toString());
    // TODO: NT app needs to send a graceful exit so we can tell the difference between
    // a quit and a disconnect. pick that up at the uWS app layer (websocket close code?)
    // and communicate it here.

    user.disconnected();

    // if the user is not in a room, we can safely clean them up
    const room = user.room();
    if (room) {
      // if the user _is_ in a room, we'll leave them in the list in case
      // they reconnect. if this user was the last active user in a room,
      // we'll destroy the entire room.
      this.gc(room);
    } else {
      this.users.delete(user.id);
    }
  }

  /**
   * Destroy a room if it contains no connected users
   *
   * @param room RoomState instance to (maybe) clean up
   */
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

  /**
   * Called when a room is destroyed. Used for bookkeeping.
   *
   * @param room RoomState instance of the room that was destroyed
   */
  roomDestroyed(room: RoomState) {
    for (const user of room.getUsers()) {
      if (!user.isConnected()) {
        this.users.delete(user.id);
      }
    }
    this.rooms.delete(room.id);
  }

  /**
   * Return the stats record for the given id, if present
   */
  getStats(roomId: string, statsId: string): string | void {
    return this.rooms.get(roomId)?.getStats(statsId);
  }

  getRoom(roomId: string): RoomState | void {
    return this.rooms.get(roomId);
  }

  /**
   * Create a new room. Fills the configured id-creators from this
   * instance's properties. Used only for testing.
   *
   * Bad abstraction; improve later. Probably we should have a
   * looser coupling for these cross-state-class interactions,
   * some kind of factory function interface maybe?
   */
  private createRoom(params: createRoomParams): RoomState | void {
    return RoomState.create({
      ...params,
      ...(this.createRoomId ? { roomId: this.createRoomId() } : {}),
      ...(this.createChatId ? { createChatId: this.createChatId } : {}),
      ...(this.createStatsId ? { createStatsId: this.createStatsId } : {}),
      ...(this.createRoomName ? { createRoomName: this.createRoomName } : {}),
    });
  }

  //// message handlers ////

  cRoomCreate(payload: NT.ClientRoomCreate, user: UserState) {
    // we're in drain mode, disallow new room creations
    if (this.isDraining) {
      user.send(
        M.sRoomCreateFailed({
          reason: 'Server is shutting down for an upgrade. Please re-launch the Noita Together application.',
        }),
      );
      return;
    }

    const { password, ...opts } = payload;
    const room = this.createRoom({
      lobby: this,
      owner: user,
      opts: {
        locked: false,
        password: password ?? undefined,
        ...opts,
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
    // TODO: HAX: this is a workaround for protobuf.js generating weird oneof-shaped things with
    // string|undefined|null values when using proto3 optionals instead of plain optional properties.
    // connecting these to TypeBox is painful, so we're just yoloing it. we can improve by dropping
    // the use of proto3 optional or making the runtypes more thoroughly align to the specifics
    // of the proto generation library we are using
    const reason = user.room()?.update(user, payload as RoomStateUpdateOpts);
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
    // we're in drain mode, disallow new room creations
    if (this.isDraining) {
      user.send(
        M.sChat({
          id: this.createChatId?.() ?? '',
          userId: SYSTEM_USER.id,
          name: SYSTEM_USER.name,
          message: 'Server is shutting down for an upgrade. Please re-launch the Noita Together application.',
        }),
      );
      return;
    }

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
