import * as NT from '../gen/messages_pb';
import {
  CreateBigRoomOpts,
  CreateRoomOpts,
  UpdateBigRoomOpts,
  UpdateRoomOpts,
  validateRoomOpts,
} from '../runtypes/room_opts';
import { Publishers, M, chat } from '../util';
import { GameActions, Handler, Handlers } from '../types';

import { UserState } from './user';
import { LobbyState, SYSTEM_USER } from './lobby';

import { PlayerPositions } from './game/player_positions';

import { v4 as uuidv4 } from 'uuid';

import Debug from 'debug';
const debug = Debug('nt:room');

let id = 0;

const DESIGN_PLAYER_START_POS_X = 227;
const DESIGN_PLAYER_START_POS_Y = -85;

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
  private readonly broadcast: ReturnType<Publishers['broadcast']>;

  readonly id: string;
  readonly owner: UserState;
  readonly topic: string;

  private users = new Set<UserState>();
  private bannedUsers = new Set<string>();
  private lastMods = new WeakMap<UserState, string>();

  private name: string;
  private gamemode: number;
  private maxUsers: number;
  private locked: boolean;
  private inProgress: boolean;
  private password?: string;

  private lastFlags: Uint8Array;

  // private playerPositions: PlayerPositions;

  private constructor(
    lobby: LobbyState,
    owner: UserState,
    { name, password, gamemode, maxUsers }: RoomStateCreateOpts,
    publishers: Publishers,
  ) {
    this.lobby = lobby;

    // this.id = `${id++}`;
    this.id = uuidv4();

    this.owner = owner;
    this.topic = `/room/${this.id}`;

    this.broadcast = publishers.broadcast(this.topic);

    this.name = name;
    this.password = password ?? undefined;
    this.gamemode = gamemode;
    this.maxUsers = maxUsers;
    this.locked = false;
    this.inProgress = false;

    this.lastFlags = RoomState.emptyFlags;

    // this.playerPositions = new PlayerPositions(this.broadcast, 50);
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

    if (owner.uaccess === 0) {
      opts.name = `${owner.name}'s room`;
    }

    const room = new RoomState(lobby, owner, opts, publishers);
    debug(room.id, 'created');

    room.users.add(owner);

    const roomData = room.getState();
    owner.send(M.sRoomCreated(roomData));

    owner.joined(room, true);
    // lobby.broadcast(M.sRoomAddToList({ room: roomData }));

    // room.playerPositions.updatePlayers(room.users);
    // room.playerPositions.push(
    //   owner.id,
    //   M.sPlayerPos({
    //     userId: owner.id,
    //     x: DESIGN_PLAYER_START_POS_X,
    //     y: DESIGN_PLAYER_START_POS_Y,
    //   }),
    // );

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

    if (opts.name !== undefined) this.name = opts.name;
    if (opts.password !== undefined) this.password = opts.password;
    if (opts.gamemode !== undefined) this.gamemode = opts.gamemode;
    if (opts.maxUsers !== undefined) this.maxUsers = opts.maxUsers;
    if (opts.locked !== undefined) this.locked = opts.locked;

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

  onUserReadyStateChange(actor: UserState, payload: NT.ClientReadyState) {
    this.broadcast(M.sUserReadyState({ userId: actor.id, ...payload }));

    if (this.inProgress && payload.ready) {
      const lastMods = this.lastMods.get(actor);
      if (lastMods !== actor.mods()) return;
      actor.send(M.sHostStart({ forced: false }));
    }
  }

  startRun(actor: UserState, payload: NT.ClientStartRun) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'start run');

    // store the mods that users had at the start of a run
    for (const user of this.users) {
      this.lastMods.set(user, user.mods());
    }

    this.inProgress = true;

    // current server just sends this with {forced: false} even though
    // the message payload contains various things. imitating that for now
    this.broadcast(M.sHostStart({ forced: false }));

    // this.broadcast(M.sHostStart(payload));
  }

  finishRun(actor: UserState) {
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

    // this.playerPositions.updatePlayers(this.users);
    // this.playerPositions.push(
    //   user.id,
    //   M.sPlayerPos({
    //     userId: user.id,
    //     x: DESIGN_PLAYER_START_POS_X,
    //     y: DESIGN_PLAYER_START_POS_Y,
    //   }),
    // );
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
      this.broadcast(chat(SYSTEM_USER, `${target.name} ${message}.`));
    }

    // this.playerPositions.updatePlayers(this.users);
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
    // this.playerPositions.destroy();

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

  cPlayerMove: Handler<NT.ClientPlayerMove> = (payload, user) => {
    if (!this.inProgress) return;
    if (payload.frames.length === 0) return;

    const { x, y } = payload.frames[payload.frames.length - 1];
    if (x === undefined || y === undefined) return;
    user.setLast(x, y);

    const small = M.sPlayerPos({ userId: user.id, x, y });
    const big = M.sPlayerMove({ userId: user.id, ...payload });

    for (const u of this.users) {
      if (user.isNear(u)) u.send(big);
      else u.send(small);
    }
  };
  // cPlayerMove: Handler<NT.ClientPlayerMove> = (payload, user) => {
  //   // NT app sends empty messages
  //   if (payload.frames.length === 0) return;

  //   // debug('cPlayerMove', payload.frames);

  //   const userId = user.id;

  //   // there's no real reason to include old frames as best I can determine,
  //   // but we'll do it anyway. maybe some frames include position changes
  //   // only and some frames include arm position only, etc.
  //   //
  //   // we're counting on the fact here that uWS will be _much_ more efficient
  //   // in terms of broadcasting the data to users, and protobuf will be compact
  //   // enough, that we're not really losing anything by sending a full update
  //   // to everybody all at once. our strategy instead will be to send synchronized
  //   // updates; that is, instead of sending one broadcast to all players every
  //   // time one message is received, we collect updates and send the latest update
  //   // every X time.
  //   //
  //   // TODO: the mod pushes a player state update every frame. the NT app passes
  //   // this on to the lobby server as-is. the NT app should only really send the
  //   // most recent update, because there's no reason we would want stale information
  //   // and this will save on network bytes pushed across the internet
  //   this.playerPositions.push(userId, M.sPlayerMove({ userId: user.id, ...payload }));
  // };
  cPlayerUpdate: Handler<NT.ClientPlayerUpdate> = (payload, user) => {
    if (!this.inProgress) return;
    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerUpdate({ userId: user.id, ...payload }));
  };
  cPlayerUpdateInventory: Handler<NT.ClientPlayerUpdateInventory> = (payload, user) => {
    // not implemented in current server
  };
  cHostItemBank: Handler<NT.ClientHostItemBank> = (payload, user) => {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostItemBank(payload));
  };
  cHostUserTake: Handler<NT.ClientHostUserTake> = (payload, user) => {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostUserTake(payload));
  };
  cHostUserTakeGold: Handler<NT.ClientHostUserTakeGold> = (payload, user) => {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostUserTakeGold(payload));
  };
  cPlayerAddGold: Handler<NT.ClientPlayerAddGold> = (payload, { id: userId }) => {
    if (!this.inProgress) return;
    this.broadcast(M.sPlayerAddGold({ userId, ...payload }));
  };
  cPlayerTakeGold: Handler<NT.ClientPlayerTakeGold> = (payload, { id: userId }) => {
    if (!this.inProgress) return;

    // { toHost: true }
    this.owner.send(M.sPlayerTakeGold({ userId, ...payload }));
  };
  cPlayerAddItem: Handler<NT.ClientPlayerAddItem> = (payload, { id: userId }) => {
    if (!this.inProgress) return;
    this.broadcast(M.sPlayerAddItem({ userId, ...payload }));
  };
  cPlayerTakeItem: Handler<NT.ClientPlayerTakeItem> = (payload, { id: userId }) => {
    if (!this.inProgress) return;

    // { toHost: true }
    this.owner.send(M.sPlayerTakeItem({ userId, ...payload }));
  };
  cPlayerPickup: Handler<NT.ClientPlayerPickup> = (payload, user) => {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerPickup({ userId: user.id, ...payload }));
    // stats stuff
    // if (this.gamemode === 0) { // coop
    //   switch (payload.kind.case) {
    //     case 'heart':
    //     break;
    //     case 'orb':
    //     break;
    //   }
    // }
  };
  cNemesisAbility: Handler<NT.ClientNemesisAbility> = (payload, user) => {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sNemesisAbility({ userId: user.id, ...payload }));
  };
  cNemesisPickupItem: Handler<NT.ClientNemesisPickupItem> = (payload, user) => {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sNemesisPickupItem({ userId: user.id, ...payload }));
  };
  cPlayerNewGamePlus: Handler<NT.ClientPlayerNewGamePlus> = (payload, user) => {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerNewGamePlus({ userId: user.id, ...payload }));
  };
  cPlayerSecretHourglass: Handler<NT.ClientPlayerSecretHourglass> = (payload, user) => {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerSecretHourglass({ userId: user.id, ...payload }));
  };
  cCustomModEvent: Handler<NT.ClientCustomModEvent> = (payload, { id: userId }) => {
    if (!this.inProgress) return;
    // in the original source:
    // {
    //   ignoreSelf: payload.ignoreSelf,
    //   toHost: payload.toHost
    // }
    // but `payload` is a string, so these would always be undefined?
    // if it's parsed as json, i don't see where that is happening
    this.broadcast(M.sCustomModEvent({ userId, ...payload }));
  };
  // cCustomModHostEvent - implemented in original, but doesn't seem to be referenced, and has no proto message
  cAngerySteve: Handler<NT.ClientAngerySteve> = (payload, user) => {
    if (!this.inProgress) return;
    // if (this.gamemode === 0) { // coop
    //   // stats stuff
    // }

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sAngerySteve({ userId: user.id, ...payload }));
  };
  cRespawnPenalty: Handler<NT.ClientRespawnPenalty> = (payload, user) => {
    if (!this.inProgress) return;
    // if (this.gamemode === 0) { // coop
    //   // stats stuff
    // }

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sRespawnPenalty({ userId: user.id, ...payload }));
  };
  cPlayerDeath: Handler<NT.ClientPlayerDeath> = (payload, user) => {
    if (!this.inProgress) return;
    // if (this.gamemode === 0) { // coop
    //   // stats stuff
    // }

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerDeath({ userId: user.id, ...payload }));
  };
  cChat: Handler<NT.ClientChat> = (payload, user) => {
    const msg = payload.message ?? '';
    if (this.owner === user && msg.startsWith('/')) {
      switch (msg.toLowerCase()) {
        case '/endrun':
          this.finishRun(user);
          break;
      }
      return;
    }
    if (msg) user.withSocket(this.broadcast, chat(user, msg));
  };
  // cPlayerEmote - implemented in original, but doesn't seem to be referenced, and has no proto message

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
