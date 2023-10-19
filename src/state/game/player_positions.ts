import { Envelope } from '../../gen/messages_pb';
import { UserState } from '../user';

import Debug from 'debug';
const debug = Debug('nt:state:game:player_position');

export class PlayerPositions {
  private pending: Buffer[] = [];
  private last: Record<string, number> = {};
  private resetLast: Record<string, number> = {};
  private timer: NodeJS.Timeout;

  constructor(broadcast: (msg: Uint8Array) => void, interval: number) {
    this.timer = setInterval(() => this.flush(broadcast), interval);
  }

  updatePlayers(users: Set<UserState>) {
    this.last = {};
    for (const user of users) {
      this.last[user.id] = -1;
    }
    this.resetLast = Object.assign({}, this.last);
  }

  push(userId: string, envelope: Envelope) {
    // TODO: game sends messages even when nothing has changed. we can avoid the
    // encoding overhead if we put a stop to that.
    var encoded = Buffer.from(envelope.toBinary());
    var last = this.last[userId];
    if (last === -1) {
      this.last[userId] = this.pending.push(encoded) - 1;
    } else {
      this.pending[last] = encoded;
    }
  }

  private flush(broadcast: (msg: Uint8Array) => void) {
    if (this.pending.length === 0) return;

    broadcast(Buffer.concat(this.pending));
    this.pending.length = 0;

    Object.assign(this.last, this.resetLast);
  }

  destroy() {
    clearInterval(this.timer);
  }
}
