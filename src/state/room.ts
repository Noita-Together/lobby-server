import * as NT from '../gen/messages_pb';
import { UserState } from './user';
import { SYSTEM_USER } from './lobby';
import { M } from '../util';
import {
  CreateBigRoomOpts,
  CreateRoomOpts,
  UpdateBigRoomOpts,
  UpdateRoomOpts,
  validateRoomOpts,
} from '../runtypes/room_opts';
import { GameActions, Handler, Handlers } from '../types';
import { Publishers } from '../util';
import { ClientRoomFlagsUpdate, ClientRunOver, ClientStartRun, Envelope } from '../gen/messages_pb';

let id = 0;
const emptyFlags = M.sRoomFlagsUpdated().toBinary();

export type RoomUserUpdate = {
  userId: string;
  name: string;
  ready: boolean;
  owner: boolean;
};
export type RoomUpdate = {
  id: string;
  name: string;
  gamemode: number;
  curUsers: number;
  maxUsers: number;
  protected: boolean;
  locked: boolean;
  owner: string;
  users: RoomUserUpdate[];
  password?: string; // lol. remove?
};

type RemoveMessageCtor = {
  new (data: { userId?: string }): NT.ServerUserLeftRoom | NT.ServerUserKicked | NT.ServerUserBanned;
};

type RoomStateCreateOpts = CreateRoomOpts | CreateBigRoomOpts;
type RoomStateUpdateOpts = UpdateRoomOpts | UpdateBigRoomOpts;

export class RoomState implements Handlers<GameActions> {
  private readonly chat: ReturnType<Publishers['chat']>;
  private readonly broadcast: ReturnType<Publishers['broadcast']>;

  readonly id: string;
  readonly owner: UserState;
  readonly topic: string;

  private users = new Set<UserState>();
  private disconnectedUsers = new Set<string>();
  private bannedUsers = new Set<string>();

  private name: string;
  private gamemode: number;
  private maxUsers: number;
  private locked: boolean;
  private inProgress: boolean;
  private password?: string;

  private lastFlags: Uint8Array = emptyFlags;

  private constructor(
    owner: UserState,
    { name, password, gamemode, maxUsers }: RoomStateCreateOpts,
    publishers: Publishers,
  ) {
    this.id = `${id++}`;
    this.owner = owner;
    this.topic = `/room/${this.id}`;

    this.broadcast = publishers.broadcast(this.topic);
    this.chat = publishers.chat(this.topic);

    this.name = name;
    this.password = password ?? undefined;
    this.gamemode = gamemode;
    this.maxUsers = maxUsers;
    this.locked = false;
    this.inProgress = false;

    this.lastFlags = emptyFlags;

    // TOOD: it'd be nicer if we can just send the user as a join message,
    // instead of "magically" adding them to the list. however, the app
    // expects any join to be a non-owner, so we have to fix that first
    this.users.add(owner);
  }

  getState({ withUsers, withPassword }: { withUsers?: boolean; withPassword?: boolean } = {}): RoomUpdate {
    const update: RoomUpdate = {
      id: this.id,
      name: this.name,
      gamemode: this.gamemode,
      curUsers: this.users.size,
      maxUsers: this.maxUsers,
      protected: !!this.password,
      locked: this.locked,
      owner: this.owner.name,
      users: [],
    };
    if (withPassword === true) update.password = this.password;

    if (withUsers === true) {
      for (const user of this.users.values()) {
        update.users.push({
          userId: user.id,
          name: user.name,
          ready: user.isReady(),
          owner: user === this.owner,
        });
      }
    }
    return update;
  }

  canJoin(user: UserState, password?: string): null | string {
    if (this.bannedUsers.has(user.id)) return 'Banned from this room.';
    if (this.users.size >= this.maxUsers) return 'Room is full.';
    if (this.password && this.password !== password) return 'Bad password.';

    // allow disconnected users to rejoin locked rooms
    if (this.disconnectedUsers.has(user.id)) return null;

    if (this.locked) return 'Room is locked.';

    return null;
  }

  static create(owner: UserState, _opts: RoomStateCreateOpts, publishers: Publishers): RoomState | string {
    let opts: RoomStateCreateOpts | string;
    if (process.env.DEV_MODE === 'true' && owner.uaccess < 3) {
      opts = 'Room creation is disabled at the moment, Server is in dev mode :)';
    } else if (owner.room() !== null) {
      opts = 'Already in a room.';
    } else {
      opts = validateRoomOpts(owner.uaccess > 1 ? CreateBigRoomOpts : CreateRoomOpts, _opts);
    }

    if (typeof opts === 'string') return opts;

    return new RoomState(owner, opts, publishers);
  }

  update(_opts: RoomStateUpdateOpts): string | void {
    console.log('update', _opts);

    const opts = validateRoomOpts(this.owner.uaccess > 1 ? UpdateBigRoomOpts : UpdateRoomOpts, _opts);
    if (typeof opts === 'string') return opts;

    if (opts.name) this.name = opts.name;
    if (opts.password) this.password = opts.password;
    if (opts.gamemode) this.gamemode = opts.gamemode;
    if (opts.maxUsers) this.maxUsers = opts.maxUsers;
    if (opts.locked) this.locked = opts.locked;

    this.broadcast(M.sRoomUpdated(opts));
  }

  setFlags(payload: ClientRoomFlagsUpdate): string | void {
    const flags = M.sRoomFlagsUpdated(payload).toBinary();
    this.lastFlags = flags;
    this.broadcast(flags);
  }

  startRun(payload: ClientStartRun) {
    this.inProgress = true;
    this.broadcast(M.sHostStart({ ...payload }));
  }

  runOver(payload: ClientRunOver) {
    this.inProgress = false;
    // this doesn't send a PB message?
    // TODO: reset "modCheck" and ready states
  }

  joined(user: UserState) {
    this.disconnectedUsers.delete(user.id);
    this.users.add(user);
    if (this.owner !== user) {
      // the app doesn't expect a join message for the owner
      this.broadcast(
        M.sUserJoinedRoom({
          userId: user.id,
          name: user.name,
        }),
      );
    }
    user.send(M.sJoinRoomSuccess(this.getState({ withUsers: true, withPassword: true })));
    // the app can't deal with receiving an empty/default flags update
    // TODO: fix that, then we can always send
    if (this.lastFlags !== emptyFlags) {
      user.send(this.lastFlags);
    }
  }

  private removeUser<T extends (data: { userId: string }) => Envelope>(msgType: T, user: UserState, message: string) {
    this.users.delete(user);
    this.broadcast(
      msgType({
        userId: user.id,
      }),
    );
    this.chat(SYSTEM_USER, `${user.name} ${message}.`);
  }

  parted(user: UserState) {
    this.removeUser(M.sUserLeftRoom, user, 'has left');
  }

  disconnected(user: UserState) {
    this.disconnectedUsers.add(user.id);
    this.removeUser(M.sUserLeftRoom, user, 'disconnected');
  }

  kicked(user: UserState) {
    this.removeUser(M.sUserKicked, user, 'has been kicked from this room');
  }

  banned(user: UserState) {
    this.bannedUsers.add(user.id);
    this.removeUser(M.sUserBanned, user, 'has been banned from this room');
  }

  destroy() {
    for (const user of this.users) {
      user.part();
    }
  }

  //// message handlers ////

  cPlayerMove: Handler<NT.ClientPlayerMove> = (payload, user) => {};
  cPlayerUpdate: Handler<NT.ClientPlayerUpdate> = (payload, user) => {};
  cPlayerUpdateInventory: Handler<NT.ClientPlayerUpdateInventory> = (payload, user) => {};
  cHostItemBank: Handler<NT.ClientHostItemBank> = (payload, user) => {};
  cHostUserTake: Handler<NT.ClientHostUserTake> = (payload, user) => {};
  cHostUserTakeGold: Handler<NT.ClientHostUserTakeGold> = (payload, user) => {};
  cPlayerAddGold: Handler<NT.ClientPlayerAddGold> = (payload, user) => {};
  cPlayerTakeGold: Handler<NT.ClientPlayerTakeGold> = (payload, user) => {};
  cPlayerAddItem: Handler<NT.ClientPlayerAddItem> = (payload, user) => {};
  cPlayerTakeItem: Handler<NT.ClientPlayerTakeItem> = (payload, user) => {};
  cPlayerPickup: Handler<NT.ClientPlayerPickup> = (payload, user) => {};
  cNemesisAbility: Handler<NT.ClientNemesisAbility> = (payload, user) => {};
  cNemesisPickupItem: Handler<NT.ClientNemesisPickupItem> = (payload, user) => {};
  cChat: Handler<NT.ClientChat> = (payload, user) => {};
  cPlayerDeath: Handler<NT.ClientPlayerDeath> = (payload, user) => {};
  cPlayerNewGamePlus: Handler<NT.ClientPlayerNewGamePlus> = (payload, user) => {};
  cPlayerSecretHourglass: Handler<NT.ClientPlayerSecretHourglass> = (payload, user) => {};
  cCustomModEvent: Handler<NT.ClientCustomModEvent> = (payload, user) => {};
  cRespawnPenalty: Handler<NT.ClientRespawnPenalty> = (payload, user) => {};
  cAngerySteve: Handler<NT.ClientAngerySteve> = (payload, user) => {};
}
