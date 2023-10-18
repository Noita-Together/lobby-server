import * as NT from '../gen/messages_pb';
import { Handler, Handlers, LobbyActions } from '../types';
import { IUser, UserState } from './user';
import { RoomState, RoomUpdate } from './room';
import { Publishers, M } from '../util';
import { WebSocket } from 'uWebsockets.js';
import { ClientAuth } from '../runtypes/client_auth';

export const SYSTEM_USER: IUser = { id: '-1', name: '[SYSTEM]' };
export const ANNOUNCEMENT: IUser = { id: '-2', name: '[ANNOUNCEMENT]' };

import Debug from 'debug';
const debug = Debug('nt:lobby');

export class LobbyState implements Handlers<LobbyActions> {
  private readonly publishers: Publishers;
  private readonly broadcast: ReturnType<Publishers['broadcast']>;
  private readonly chat: ReturnType<Publishers['chat']>;

  readonly topic = 'lobby';

  private rooms = new Map<string, RoomState>();
  private users = new Map<string, UserState>();

  constructor(publishers: Publishers) {
    this.publishers = publishers;
    this.broadcast = publishers.broadcast(this.topic);
    this.chat = publishers.chat(this.topic);
  }

  userConnected(ws: WebSocket<ClientAuth>): UserState {
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
    debug(id, name, 'connected');

    // TODO: what happens if a user launches multiple clients?
    let user: UserState | undefined = this.users.get(id);
    if (user) {
      user.reconnected(ws);
    } else {
      user = new UserState(this, { id, name }, ws);
      user.connected(ws);
    }

    return user;
  }

  userDisconnected(user: UserState, code: number, message: ArrayBuffer) {
    debug(user.id, user.name, 'disconnected');
    // TODO: NT app needs to send a graceful exit so we can tell the difference between
    // a quit and a disconnect. pick that up at the uWS app layer (websocket close code?)
    // and communicate it here.

    // if the user is not in a room, we can safely clean them up
    if (user.room() === null) {
      this.users.delete(user.id);
      user.destroy();
    } else {
      // if the user _is_ in a room, we'll leave them in the list in case
      // they reconnect.
      user.disconnected();
    }
  }

  // add a user's "existence" to the lobby
  addUser(user: UserState) {
    this.users.set(user.id, user);
  }

  roomDestroyed(room: RoomState) {
    this.rooms.delete(room.id);
  }

  //// message handlers ////

  cRoomCreate: Handler<NT.ClientRoomCreate> = (payload, user) => {
    const room = RoomState.create(this, user, { ...payload, locked: false }, this.publishers);

    if (typeof room === 'string') {
      user.send(M.sRoomCreateFailed({ reason: room }));
      return;
    }

    this.rooms.set(room.id, room);

    const roomData = room.getState({ withUsers: true });
    user.send(M.sRoomCreated(roomData));
    this.broadcast(M.sRoomAddToList({ room: roomData }));

    // TODO: creator is implicitly joined to the room currently.
    // we can reduce complexity of behavior by making it explicit
    // room.join(user);
  };

  cRoomDelete: Handler<NT.ClientRoomDelete> = (payload, user) => {
    user.room()?.delete(user);
  };

  cRoomUpdate: Handler<NT.ClientRoomUpdate> = (payload, user) => {
    const reason = user.room()?.update(user, payload);
    if (reason) user.send(M.sRoomUpdateFailed({ reason }));
  };

  cRoomFlagsUpdate: Handler<NT.ClientRoomFlagsUpdate> = (payload, user) => {
    const reason = user.room()?.setFlags(user, payload);
    if (reason) user.send(M.sRoomFlagsUpdateFailed({ reason }));
  };

  cJoinRoom: Handler<NT.ClientJoinRoom> = (payload, user) => {
    let error: string | null;

    const room = this.rooms.get(payload.id);
    if (!room) {
      error = "Room doesn't exist";
    } else {
      error = room.join(user, payload.password);
    }

    if (typeof error === 'string') {
      user.send(M.sJoinRoomFailed({ reason: error }));
      return;
    }
  };
  cLeaveRoom: Handler<NT.ClientLeaveRoom> = (_, user) => {
    user.room()?.part(user);
  };
  cKickUser: Handler<NT.ClientKickUser> = (payload, user) => {
    user.room()?.kick(user, this.users.get(payload.userId));
  };
  cBanUser: Handler<NT.ClientBanUser> = (payload, user) => {
    user.room()?.kick(user, this.users.get(payload.userId));
  };
  cReadyState: Handler<NT.ClientReadyState> = (payload, user) => {
    user.updateReadyState(payload);
  };
  cStartRun: Handler<NT.ClientStartRun> = (payload, user) => {
    user.room()?.startRun(user, payload);
  };
  cRequestRoomList: Handler<NT.ClientRequestRoomList> = (payload, user) => {
    const rooms: RoomUpdate[] = [];
    for (const room of this.rooms.values()) {
      rooms.push(room.getState());
    }
    user.send(
      M.sRoomList({
        pages: 0, // not implemented
        rooms,
      }),
    );
  };
  cRunOver: Handler<NT.ClientRunOver> = (payload, user) => {
    user.room()?.finishRun(user, payload);
  };
}
