import * as NT from '../gen/messages_pb';
import {
  CreateBigRoomOpts,
  CreateRoomOpts,
  UpdateBigRoomOpts,
  UpdateRoomOpts,
  validateRoomOpts,
} from '../runtypes/room_opts';
import { Publishers, M } from '../util';
import { GameActions, Handler, Handlers } from '../types';

import { UserState } from './user';
import { LobbyState, SYSTEM_USER } from './lobby';

import Debug from 'debug';
const debug = Debug('nt:room');

let id = 0;

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
  password: string; // lol. remove?
  users: RoomUserUpdate[];
};

type RoomStateCreateOpts = CreateRoomOpts | CreateBigRoomOpts;
type RoomStateUpdateOpts = UpdateRoomOpts | UpdateBigRoomOpts;

export class RoomState implements Handlers<GameActions> {
  private static readonly emptyFlags = M.sRoomFlagsUpdated().toBinary();

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

  private lastFlags: Uint8Array;

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

    this.lastFlags = RoomState.emptyFlags;
  }

  getUsers(): IterableIterator<UserState> {
    return this.users.values();
  }

  private roomUpdateUserData(user: UserState) {
    return {
      userId: user.id,
      name: user.name,
      ready: user.isReady(),
      owner: user === this.owner,
    };
  }

  getState(): RoomUpdate {
    // TODO: not all of these fields get used by every protobuf message. in particular,
    // `password` is elided from most of the messages when being encoded. ideally, we
    // wouldn't send password at all, ever, but the PB for create room confirmation
    // currently expects it, so we'll keep it for now. to avoid needing to make changes
    // to the NT app
    return {
      id: this.id,
      name: this.name,
      gamemode: this.gamemode,
      curUsers: this.users.size,
      maxUsers: this.maxUsers,
      protected: !!this.password,
      locked: this.locked,
      owner: this.owner.name,
      password: this.password ?? '',
      users: [...this.users.values()].map((u) => this.roomUpdateUserData(u)),
    };
  }

  static create(
    lobby: LobbyState,
    owner: UserState,
    _opts: RoomStateCreateOpts,
    publishers: Publishers,
  ): RoomState | void {
    let opts: RoomStateCreateOpts | string;

    if (process.env.DEV_MODE === 'true' && owner.uaccess < 3) {
      owner.send(M.sRoomCreateFailed({ reason: 'Room creation is disabled at the moment, Server is in dev mode :)' }));
      return;
    }

    if (owner.room() !== null) {
      // user owned another room. probably they reconnected. destroy old room.
      owner.room()!.destroy();
    }

    opts = validateRoomOpts(owner.uaccess > 1 ? CreateBigRoomOpts : CreateRoomOpts, _opts);

    if (typeof opts === 'string') {
      owner.send(M.sRoomCreateFailed({ reason: opts }));
      return;
    }

    const room = new RoomState(lobby, owner, opts, publishers);
    debug(room.id, 'created');

    room.users.add(owner);
    owner.joined(room);

    const roomData = room.getState();
    owner.send(M.sRoomCreated(roomData));
    lobby.broadcast(M.sRoomAddToList({ room: roomData }));

    return room;
  }

  update(actor: UserState, _opts: RoomStateUpdateOpts): string | void {
    if (this.owner !== actor) return "Can't do that.";

    // TODO: is this valid during a run?

    const opts = validateRoomOpts(this.owner.uaccess > 1 ? UpdateBigRoomOpts : UpdateRoomOpts, _opts);
    if (typeof opts === 'string') return opts;

    if (debug.enabled) {
      debug(this.id, 'updating options', this.optsValue(_opts, opts));
    }

    if (opts.name) this.name = opts.name;
    if (opts.password) this.password = opts.password;
    if (opts.gamemode) this.gamemode = opts.gamemode;
    if (opts.maxUsers) this.maxUsers = opts.maxUsers;
    if (opts.locked) this.locked = opts.locked;

    this.broadcast(M.sRoomUpdated(opts));
  }

  setFlags(actor: UserState, payload: NT.ClientRoomFlagsUpdate): string | void {
    if (this.owner !== actor) return "Can't do that.";

    debug(this.id, 'updating flags', payload.flags.map(this.flagValue));

    // TODO: is this valid during a run?
    const flags = M.sRoomFlagsUpdated(payload).toBinary();

    // store the last-known flags as an already-encoded buffer, since we'll be
    // replaying it to people who join
    this.lastFlags = flags;

    this.broadcast(flags);
  }

  getFlags(): Uint8Array {
    return this.lastFlags;
  }

  startRun(actor: UserState, payload: NT.ClientStartRun) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'start run');

    this.inProgress = true;

    // current server just sends this with {forced: false} even though
    // the message payload contains various things. imitating that for now
    this.broadcast(M.sHostStart({ forced: false }));

    // this.broadcast(M.sHostStart(payload));
  }

  finishRun(actor: UserState, payload: NT.ClientRunOver) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'finish run');

    this.inProgress = false;
    // this doesn't send a PB message?
    // TODO: reset "modCheck" and ready states
  }

  join(user: UserState, password?: string): void {
    let reason: string | null = null;
    const room = user.room();

    if (!room) {
      // user isn't in any room, do the usual checks
      if (this.bannedUsers.has(user.id)) reason = 'Banned from this room.';
      else if (this.users.size >= this.maxUsers) reason = 'Room is full.';
      else if (this.password && this.password !== password) reason = 'Bad password.';
      else if (this.locked) reason = 'Room is locked.';
    } else if (room !== this) {
      // user got disconnected while in a room, but is trying to join a different
      // room. remove them from their previous room.

      if (room.owner === user) {
        room.destroy();
      } else {
        user.parted(room);
      }
    } else {
      // user got disconnected while in a room, and is rejoining it. allow them in
    }

    if (reason) {
      user.send(M.sJoinRoomFailed({ reason }));
      return;
    }

    debug(this.id, 'user joining', user.id, user.name);
    this.users.add(user);

    // broadcast the join to everyone except the user that joined
    // that user will receive a different confirmation in `user.joined`
    user.broadcast(
      this.topic,
      M.sUserJoinedRoom({
        userId: user.id,
        name: user.name,
      }),
    );
    user.joined(this);
  }

  private removeUser<T extends (...args: any) => NT.Envelope>(
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
      // otherwise, remove user from room and notify everybody
      this.users.delete(target);

      // update leaving user state and subscriptions before sending the chat update
      target.parted(this);

      // send the control message confirming the removal
      this.broadcast(pb({ userId: target.id }));

      // send a chat message to the room
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

    // must send this message before calling this.destroy() - otherwise,
    // the users will have been unsubscribed from the topic and will not
    // receive the message
    this.broadcast(M.sRoomDeleted({ id: this.id }));

    this.destroy();
    debug(this.id, 'deleted');
  }

  destroy() {
    for (const user of this.users) {
      // uWS _says_ that ordering of sends and unsubscribes is guaranteed, but if
      // we broadcast to the topic and then unsubscribe, the client does not appear
      // to be receiving the message.
      user.parted(this);
    }
    this.users.clear();

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

  //// helpers ////
  private flagValue = (flag: NT.ClientRoomFlagsUpdate_GameFlag) => {
    // TODO: the NT app weirdly/incorrectly uses _optionality_ of flag message fields to signal
    // whether they are enabled or disabled. improving this requires a change to the app itself.
    // since we are unable to determine the expected type of a flag, we must currently rely on
    // assumptions about how the app behaves:
    // - the app only sends numeric or boolean flags
    // - numbers are set in the "uIntVal" field
    // - booleans are true if present, false if absent
    if (flag.uIntVal !== undefined) {
      return `${flag.flag}=${flag.uIntVal ?? 0}`;
    } else {
      return `${flag.flag}=true`;
    }
  };

  private static readonly validProps = new Set<string>(Object.keys(CreateRoomOpts.properties));
  private static readonly sym_unknown: unique symbol = Symbol('unknown');
  private optsValue = (received: Partial<CreateRoomOpts>, validated: Partial<CreateRoomOpts>) => {
    const res: any = {};
    const unknown: string[] = [];
    for (const key of Object.keys(validated) as (keyof CreateRoomOpts)[]) {
      if (validated[key] === undefined) continue;

      if (RoomState.validProps.has(key)) {
        res[key] = [this[key], received[key], validated[key]];
      } else {
        unknown.push(key);
      }
    }
    if (unknown.length > 0) res[RoomState.sym_unknown] = unknown;
    return res;
  };
}
