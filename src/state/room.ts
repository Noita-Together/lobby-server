import * as NT from '../gen/messages_pb';
import {
  CreateBigRoomOpts,
  CreateRoomOpts,
  UpdateBigRoomOpts,
  UpdateRoomOpts,
  validateRoomOpts,
} from '../runtypes/room_opts';
import { Publishers, M, createChat } from '../util';
import { tagPlayerMove } from '../protoutil';
import { GameActions, Handlers } from '../types';

import { IUser, UserState } from './user';
import { LobbyState, SYSTEM_USER } from './lobby';

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
  private allowedMods = new WeakMap<UserState, string>();

  private name: string;
  private gamemode: number;
  private maxUsers: number;
  private locked: boolean;
  private inProgress: boolean;
  private password?: string;

  private lastFlags: Uint8Array;

  private chat: (user: IUser, message: string) => NT.Envelope;
  // private playerPositions: PlayerPositions;

  private constructor(
    lobby: LobbyState,
    owner: UserState,
    { name, password, gamemode, maxUsers }: RoomStateCreateOpts,
    publishers: Publishers,
    roomId?: string,
    createChatId?: () => string,
  ) {
    this.chat = createChat(createChatId);
    this.lobby = lobby;

    // this.id = `${id++}`;
    this.id = roomId ?? uuidv4();

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

  static create({
    lobby,
    owner,
    opts: _opts,
    publishers,
    devMode,
    roomId,
    createChatId,
  }: {
    lobby: LobbyState;
    owner: UserState;
    opts: RoomStateCreateOpts;
    publishers: Publishers;
    devMode: boolean;
    roomId?: string;
    createChatId?: () => string;
  }): RoomState | void {
    let opts: RoomStateCreateOpts | string;

    if (devMode && owner.uaccess < 3) {
      owner.send(M.sRoomCreateFailed({ reason: 'Room creation is disabled at the moment, Server is in dev mode :)' }));
      return;
    }

    opts = validateRoomOpts(owner.uaccess > 1 ? CreateBigRoomOpts : CreateRoomOpts, _opts);

    if (typeof opts === 'string') {
      owner.send(M.sRoomCreateFailed({ reason: opts }));
      return;
    }

    // user owned another room. probably they reconnected. destroy old room.
    owner.room()?.delete(owner);

    if (owner.uaccess === 0) {
      opts.name = `${owner.name}'s room`;
    }

    const room = new RoomState(lobby, owner, opts, publishers, roomId, createChatId);
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

    /* istanbul ignore next */
    if (debug.enabled) {
      debug(this.id, 'updating options', this.DEBUG_ONLY_optsValue(_opts, opts));
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

    debug(this.id, 'updating flags', payload.flags.map(this.DEBUG_ONLY_flagValue));

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
      const allowedMods = this.allowedMods.get(actor);
      if (allowedMods !== actor.mods()) return;
      actor.send(M.sHostStart({ forced: false }));
    }
  }

  startRun(actor: UserState, payload: NT.ClientStartRun) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'start run');

    // store the mods that users had at the start of a run
    for (const user of this.users) {
      this.allowedMods.set(user, user.mods());
    }

    this.inProgress = true;

    // current server just sends this with {forced: false} even though
    // the message payload contains various things. imitating that for now
    this.broadcast(M.sHostStart({ forced: false }));

    // this.broadcast(M.sHostStart(payload));
  }

  private resetUserStates() {
    // the run is over. reset the "allowed mods" list
    this.allowedMods = new WeakMap();

    // TODO: should the _server_ reset the "ready" flag on
    // the users, or will the app do the right thing out of
    // the box?
    //
    // since there's no message for "the run ended", i'm
    // guessing not, but i also don't know whether the clients
    // will correctly send a ready state update if i push out
    // an empty readystate. investigation needed
  }

  finishRun(actor: UserState) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'finish run');

    this.inProgress = false;
    this.resetUserStates();
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
      // user (probably) got disconnected while in a room, but is trying to join a different
      // room. delete the old room if user is the owner, otherwise just leave
      room.delete(user) || room.part(user);
    } else {
      // user (probably) got disconnected while in a room, and is rejoining it. allow them in
      // the NT app currently provides no way to join a room without leaving the
      // current room, but could in the future. if so, this assumption changes
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
    /* istanbul ignore next */
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

    // when the owner leaves the room, destroy it
    if (this.delete(target)) return;

    // otherwise, remove user from room and notify everybody
    this.users.delete(target);

    // update leaving user state and subscriptions before sending the chat update
    target.parted(this);

    // send the control message confirming the removal
    this.broadcast(pb({ userId: target.id }));

    // send a chat message to the room
    this.broadcast(this.chat(SYSTEM_USER, `${target.name} ${message}`));

    // this.playerPositions.updatePlayers(this.users);
    debug(this.id, 'user left', target.id, target.name, message);
  }

  part(actor: UserState) {
    this.removeUser(null, actor, M.sUserLeftRoom, 'has left.');
  }

  kick(actor: UserState, target: UserState) {
    this.removeUser(actor, target, M.sUserKicked, 'has been kicked from this room.');
  }

  ban(actor: UserState, target: UserState) {
    this.bannedUsers.add(target.id);
    this.removeUser(actor, target, M.sUserBanned, 'has been banned from this room.');
  }

  // thin wrapper around destroy to check permission
  delete(actor: UserState): boolean {
    // no error for this one either if invalid
    if (this.owner !== actor) return false;

    this.destroy();
    return true;
  }

  // tear down a room and its state
  destroy() {
    this.broadcast(M.sRoomDeleted({ id: this.id }));

    // this.playerPositions.destroy();

    for (const user of this.users) {
      // uWS _says_ that ordering of sends and unsubscribes is guaranteed, but if
      // we broadcast to the topic and then unsubscribe, the client does not appear
      // to be receiving the message.
      user.parted(this);
    }
    this.users.clear();

    this.lobby.roomDestroyed(this);
    debug(this.id, 'destroyed');
  }

  //// message handlers ////

  playerMoveRaw(payload: Buffer, user: UserState) {
    if (!this.inProgress) return;

    const bigUpdate = tagPlayerMove(payload, user.playerIdBuf);
    if (!bigUpdate) return;

    user.broadcast(this.topic, new Uint8Array(bigUpdate));
  }

  cPlayerUpdate(payload: NT.ClientPlayerUpdate, user: UserState) {
    if (!this.inProgress) return;
    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerUpdate({ userId: user.id, ...payload }));
  }
  cPlayerUpdateInventory(payload: NT.ClientPlayerUpdateInventory, user: UserState) {
    // not implemented in current server
  }
  cHostItemBank(payload: NT.ClientHostItemBank, user: UserState) {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostItemBank(payload));
  }
  cHostUserTake(payload: NT.ClientHostUserTake, user: UserState) {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostUserTake(payload));
  }
  cHostUserTakeGold(payload: NT.ClientHostUserTakeGold, user: UserState) {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostUserTakeGold(payload));
  }
  cPlayerAddGold(payload: NT.ClientPlayerAddGold, { id: userId }: UserState) {
    if (!this.inProgress) return;
    this.broadcast(M.sPlayerAddGold({ userId, ...payload }));
  }
  cPlayerTakeGold(payload: NT.ClientPlayerTakeGold, { id: userId }: UserState) {
    if (!this.inProgress) return;

    // { toHost: true }
    this.owner.send(M.sPlayerTakeGold({ userId, ...payload }));
  }
  cPlayerAddItem(payload: NT.ClientPlayerAddItem, { id: userId }: UserState) {
    if (!this.inProgress) return;
    this.broadcast(M.sPlayerAddItem({ userId, ...payload }));
  }
  cPlayerTakeItem(payload: NT.ClientPlayerTakeItem, { id: userId }: UserState) {
    if (!this.inProgress) return;

    // { toHost: true }
    this.owner.send(M.sPlayerTakeItem({ userId, ...payload }));
  }
  cPlayerPickup(payload: NT.ClientPlayerPickup, user: UserState) {
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
  }
  cNemesisAbility(payload: NT.ClientNemesisAbility, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sNemesisAbility({ userId: user.id, ...payload }));
  }
  cNemesisPickupItem(payload: NT.ClientNemesisPickupItem, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sNemesisPickupItem({ userId: user.id, ...payload }));
  }
  cPlayerNewGamePlus(payload: NT.ClientPlayerNewGamePlus, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerNewGamePlus({ userId: user.id, ...payload }));
  }
  cPlayerSecretHourglass(payload: NT.ClientPlayerSecretHourglass, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerSecretHourglass({ userId: user.id, ...payload }));
  }
  cCustomModEvent(payload: NT.ClientCustomModEvent, { id: userId }: UserState) {
    if (!this.inProgress) return;
    // in the original source:
    // {
    //   ignoreSelf: payload.ignoreSelf,
    //   toHost: payload.toHost
    // }
    // but `payload` is a string, so these would always be undefined?
    // if it's parsed as json, i don't see where that is happening
    this.broadcast(M.sCustomModEvent({ userId, ...payload }));
  }
  // cCustomModHostEvent - implemented in original, but doesn't seem to be referenced, and has no proto message
  cAngerySteve(payload: NT.ClientAngerySteve, user: UserState) {
    if (!this.inProgress) return;
    // if (this.gamemode === 0) { // coop
    //   // stats stuff
    // }

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sAngerySteve({ userId: user.id, ...payload }));
  }
  cRespawnPenalty(payload: NT.ClientRespawnPenalty, user: UserState) {
    if (!this.inProgress) return;
    // if (this.gamemode === 0) { // coop
    //   // stats stuff
    // }

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sRespawnPenalty({ userId: user.id, ...payload }));
  }
  cPlayerDeath(payload: NT.ClientPlayerDeath, user: UserState) {
    if (!this.inProgress) return;
    // if (this.gamemode === 0) { // coop
    //   // stats stuff
    // }

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerDeath({ userId: user.id, ...payload }));
  }
  cChat(payload: NT.ClientChat, user: UserState) {
    if (!payload.message) return;
    const msg = payload.message!;
    if (this.owner === user && msg.startsWith('/')) {
      switch (msg.toLowerCase()) {
        case '/endrun':
          this.finishRun(user);
          break;
      }
      return;
    }
    user.withSocket(this.broadcast, this.chat(user, msg));
  }
  // cPlayerEmote - implemented in original, but doesn't seem to be referenced, and has no proto message

  //// helpers ////
  private static readonly validProps = new Set<string>(Object.keys(CreateRoomOpts.properties));
  private static readonly sym_unknown: unique symbol = Symbol('unknown');

  /*istanbul ignore next*/
  private DEBUG_ONLY_flagValue = (flag: NT.ClientRoomFlagsUpdate_GameFlag) => {
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

  /* istanbul ignore next */
  private DEBUG_ONLY_optsValue = (received: Partial<CreateRoomOpts>, validated: Partial<CreateRoomOpts>) => {
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
