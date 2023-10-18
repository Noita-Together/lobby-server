import * as NT from '../gen/messages_pb';
import { UserState } from './user';
import { LobbyState, SYSTEM_USER } from './lobby';
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

import Debug from 'debug';
const debug = Debug('nt:room');

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

type RoomStateCreateOpts = CreateRoomOpts | CreateBigRoomOpts;
type RoomStateUpdateOpts = UpdateRoomOpts | UpdateBigRoomOpts;

export class RoomState implements Handlers<GameActions> {
  private readonly lobby: LobbyState;
  private readonly chat: ReturnType<Publishers['chat']>;
  private readonly broadcast: ReturnType<Publishers['broadcast']>;

  readonly id: string;
  readonly owner: UserState;
  readonly topic: string;

  private users = new Set<UserState>();
  private bannedUsers = new Set<string>();

  private name: string;
  private gamemode: number;
  private maxUsers: number;
  private locked: boolean;
  private inProgress: boolean;
  private password?: string;

  private lastFlags: Uint8Array = emptyFlags;

  private constructor(
    lobby: LobbyState,
    owner: UserState,
    { name, password, gamemode, maxUsers }: RoomStateCreateOpts,
    publishers: Publishers,
  ) {
    this.lobby = lobby;

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

  static create(
    lobby: LobbyState,
    owner: UserState,
    _opts: RoomStateCreateOpts,
    publishers: Publishers,
  ): RoomState | string {
    let opts: RoomStateCreateOpts | string;
    if (process.env.DEV_MODE === 'true' && owner.uaccess < 3) {
      opts = 'Room creation is disabled at the moment, Server is in dev mode :)';
    } else if (owner.room() !== null) {
      opts = 'Already in a room.';
    } else {
      opts = validateRoomOpts(owner.uaccess > 1 ? CreateBigRoomOpts : CreateRoomOpts, _opts);
    }

    if (typeof opts === 'string') return opts;

    const room = new RoomState(lobby, owner, opts, publishers);

    debug(room.id, 'created');

    return room;
  }

  update(actor: UserState, _opts: RoomStateUpdateOpts): string | void {
    if (this.owner !== actor) return "Can't do that.";

    // TODO: is this valid during a run?

    const opts = validateRoomOpts(this.owner.uaccess > 1 ? UpdateBigRoomOpts : UpdateRoomOpts, _opts);
    if (typeof opts === 'string') return opts;

    if (debug.enabled) {
      debug(this.id, 'updating options', {
        name: `\`${this.name}\`->\`${_opts.name}\`->\`${opts.name}\``,
        gamemode: `\`${this.gamemode}\`->\`${_opts.gamemode}\`->\`${opts.gamemode}\``,
        maxUsers: `\`${this.maxUsers}\`->\`${_opts.maxUsers}\`->\`${opts.maxUsers}\``,
        locked: `\`${this.locked}\`->\`${_opts.locked}\`->\`${opts.locked}\``,
      });
    }

    if (opts.name) this.name = opts.name;
    if (opts.password) this.password = opts.password;
    if (opts.gamemode) this.gamemode = opts.gamemode;
    if (opts.maxUsers) this.maxUsers = opts.maxUsers;
    if (opts.locked) this.locked = opts.locked;

    this.broadcast(M.sRoomUpdated(opts));
  }

  setFlags(actor: UserState, payload: ClientRoomFlagsUpdate): string | void {
    if (this.owner !== actor) return "Can't do that.";

    // TODO: is this valid during a run?

    debug(this.id, 'updating flags', payload);
    const flags = M.sRoomFlagsUpdated(payload).toBinary();
    this.lastFlags = flags;
    this.broadcast(flags);
  }

  getFlags(): Uint8Array {
    return this.lastFlags;
  }

  startRun(actor: UserState, payload: ClientStartRun) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'start run');

    this.inProgress = true;

    // current server just sends this with {forced: false} even though
    // the message payload contains various things. imitating that for now
    this.broadcast(M.sHostStart({ forced: false }));

    // this.broadcast(M.sHostStart(payload));
  }

  finishRun(actor: UserState, payload: ClientRunOver) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'finish run');

    this.inProgress = false;
    // this doesn't send a PB message?
    // TODO: reset "modCheck" and ready states
  }

  join(user: UserState, password?: string): string | null {
    if (user.room() !== null) return 'Already in a room.';
    if (this.bannedUsers.has(user.id)) return 'Banned from this room.';
    if (this.users.size >= this.maxUsers) return 'Room is full.';
    if (this.password && this.password !== password) return 'Bad password.';
    if (this.locked) return 'Room is locked.';

    this.users.add(user);

    // broadcast the join to everyone except the user that joined
    // that user will receive a different confirmation in `user.joined`
    this.broadcast(
      M.sUserJoinedRoom({
        userId: user.id,
        name: user.name,
      }),
    );

    user.joined(this);

    debug(this.id, 'user joined', user.id, user.name);
    return null;
  }

  private removeUser<T extends (...args: any) => Envelope>(
    actor: UserState | null,
    target: UserState | undefined,
    pb: T,
    message: string,
  ) {
    if (!target) {
      // this should never happen, but the return type of (Map)users.get(userid) is _technically_
      // UserState|undefined, so if some state gets wrong we want to know about it
      console.error('BUG: removeUser called with an undefined user', new Error().stack);
      return;
    }

    // when actor is specified, it's an admin action like a kick or a ban. there's
    // no response message in the proto yet to describe a failed attempt, so we just
    // ignore these
    if (actor !== null && this.owner !== actor) return;

    if (this.owner === target) {
      // when the owner leaves the room, destroy it
      this.destroy();
    } else {
      this.users.delete(target);
      this.broadcast(pb({ userId: target.id }));
      this.chat(SYSTEM_USER, `${target.name} ${message}.`);
    }

    debug(this.id, 'user left', target.id, target.name, message);
  }

  part(actor: UserState) {
    this.removeUser(null, actor, M.sUserLeftRoom, 'has left');
  }

  kick(actor: UserState, target?: UserState) {
    this.removeUser(actor, target, M.sUserKicked, 'has been kicked from this room');
  }

  ban(actor: UserState, target?: UserState) {
    this.removeUser(actor, target, M.sUserBanned, 'has been banned from this room');
  }

  delete(actor: UserState) {
    // no error for this one either if invalid
    if (this.owner !== actor) return;

    this.destroy();
    debug(this.id, 'deleted');
  }

  private destroy() {
    for (const user of this.users) {
      user.parted(this);
      this.users.delete(user);
    }

    this.lobby.roomDestroyed(this);
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
