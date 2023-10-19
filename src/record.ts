import { Message } from '@bufbuild/protobuf';

import { Envelope } from './gen/messages_pb';

let tick = 0;

const actions: any[] = [];

let timer: NodeJS.Immediate | null = null;
const bumpTick = () => {
  if (timer === null) {
    timer = setImmediate(() => {
      tick++;
      timer = null;
    });
  }
};

export const recordReceive = (userid: string, contents: ArrayBuffer) => {
  bumpTick();
  actions.push(['receive', tick, userid, Buffer.from(contents).toString('hex')]);
};
export const recordSend = (userid: string, contents: Uint8Array | Message<any>, ret: number) => {
  bumpTick();
  actions.push([
    'send',
    tick,
    userid,
    Buffer.from(contents instanceof Uint8Array ? contents : contents.toBinary()).toString('hex'),
    ret,
  ]);
};
export const recordPublish = (userid: string | 'app', topic: string, contents: Uint8Array | Envelope, ret: boolean) => {
  bumpTick();
  actions.push([
    'publish',
    tick,
    userid,
    topic,
    Buffer.from(contents instanceof Uint8Array ? contents : contents.toBinary()).toString('hex'),
    ret,
  ]);
};
export const recordSubscribe = (userid: string, topic: string, ret: boolean) => {
  bumpTick();
  actions.push(['subscribe', tick, userid, topic, ret]);
};
export const recordUnsubscribe = (userid: string, topic: string, ret: boolean) => {
  bumpTick();
  actions.push(['unsubscribe', tick, userid, topic, ret]);
};

process.on('SIGINT', () => {
  for (const [idx, action] of actions.entries()) {
    console.log('/*' + ('0' + idx).slice(-2) + '*/  ' + JSON.stringify(action) + ',');
  }
  process.exit();
});
