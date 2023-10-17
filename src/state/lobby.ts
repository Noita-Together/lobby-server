import * as NT from '../gen/messages_pb';
import { Handler, Handlers, LobbyActions } from '../types';
import { IUser, UserState } from './user';
import { RoomState, RoomUpdate } from './room';
import { Publishers, M } from '../util';

export const SYSTEM_USER: IUser = { id: '-1', name: '[SYSTEM]' };
export const ANNOUNCEMENT: IUser = { id: '-2', name: '[ANNOUNCEMENT]' };

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

  // add a user's "existence" to the lobby
  addUser(user: UserState) {
    this.users.set(user.id, user);
  }

  // remove a user's "existence" from the lobby
  delUser(user: UserState) {
    this.users.delete(user.id);
  }

  //// message handlers ////

  cRoomCreate: Handler<NT.ClientRoomCreate> = (payload, user) => {
    console.log('cRoomCreate', payload);
    const room = RoomState.create(user, { ...payload, locked: false }, this.publishers);

    if (typeof room === 'string') {
      user.send(M.sRoomCreateFailed({ reason: room }));
      return;
    }

    this.rooms.set(room.id, room);

    const roomData = room.getState({ withUsers: true });
    user.send(M.sRoomCreated(roomData));
    this.broadcast(M.sRoomAddToList({ room: roomData }));

    user.join(room);
  };

  cRoomDelete: Handler<NT.ClientRoomDelete> = (payload, user) => {
    user.roomAdmin((room) => {
      room.destroy();
      this.rooms.delete(room.id);
    });
  };

  cRoomUpdate: Handler<NT.ClientRoomUpdate> = (payload, user) => {
    user.roomAdmin(
      (room) => room.update(payload),
      (reason) => M.sRoomUpdateFailed({ reason }),
    );
  };

  cRoomFlagsUpdate: Handler<NT.ClientRoomFlagsUpdate> = (payload, user) => {
    console.log('cRoomFlagsUpdate', payload);
    user.roomAdmin(
      (room) => {}, //room.setFlags(payload),
      (reason) => M.sRoomFlagsUpdateFailed({ reason }),
    );
  };

  cJoinRoom: Handler<NT.ClientJoinRoom> = (payload, user) => {
    let error: string | null;

    const room = this.rooms.get(payload.id);
    if (!room) {
      error = "Room doesn't exist";
    } else if (user.room() !== null) {
      error = 'Already in a room.';
    } else {
      error = room.canJoin(user, payload.password);
    }

    if (typeof error === 'string') {
      user.send(M.sJoinRoomFailed({ reason: error }));
      return;
    }

    user.join(room!);
  };
  cLeaveRoom: Handler<NT.ClientLeaveRoom> = (_, user) => {
    user.part();
  };
  cKickUser: Handler<NT.ClientKickUser> = (payload, user) => {
    user.roomAdmin((room) => this.users.get(payload.userId)?.kickFrom(room));
  };
  cBanUser: Handler<NT.ClientBanUser> = (payload, user) => {
    user.roomAdmin((room) => this.users.get(payload.userId)?.banFrom(room));
  };
  cReadyState: Handler<NT.ClientReadyState> = (payload, user) => {
    user.updateReadyState(payload);
  };
  cStartRun: Handler<NT.ClientStartRun> = (payload, user) => {
    user.roomAdmin((room) => room.startRun(payload));
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
    user.roomAdmin((room) => room.runOver(payload));
  };
}
