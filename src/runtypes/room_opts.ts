import { Static, Type as T } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import Debug from 'debug';
import { randomRoomName } from '../util';
const debug = Debug('nt:runtypes:room_options');

// https://github.com/validatorjs/validator.js/blob/b958bd7d1026a434ad3bf90064d3dcb8b775f1a9/src/lib/isAscii.js#L7
// modified to exclude < ascii 32
const asciiRE = /^[\x20-\x7F]+$/;

const saneString = {
  pattern: String(asciiRE).slice(1, -1),
  minLength: 1,
  maxLength: 50,
};

const createRoomOpts = {
  name: T.String(saneString),
  password: T.Optional(T.String(saneString)),
  gamemode: T.Integer({ minimum: 0 }),
  locked: T.Boolean(),
};

// There are currently(?) two "uaccess" modes that matter to room creation: default (0)
// and privileged (non-zero). Privileged users may choose their room's name and are
// allowed to create larger rooms. When validating room options, we select either
// "CreateRoomOpts" or "CreateBigRoomOpts" depending on the user's access level.

export const CreateRoomOpts = T.Object({
  ...createRoomOpts,
  maxUsers: T.Integer({ minimum: 1, maximum: 30 }),
});
export type CreateRoomOpts = Static<typeof CreateRoomOpts>;

export const CreateBigRoomOpts = T.Object({
  ...createRoomOpts,
  maxUsers: T.Integer({ minimum: 1, maximum: 120 }),
});
export type CreateBigRoomOpts = Static<typeof CreateRoomOpts>;

export const UpdateRoomOpts = T.Partial(CreateRoomOpts);
export type UpdateRoomOpts = Static<typeof UpdateRoomOpts>;

export const UpdateBigRoomOpts = T.Partial(CreateBigRoomOpts);
export type UpdateBigRoomOpts = Static<typeof UpdateBigRoomOpts>;

export const validateRoomOpts = <
  Schema extends typeof CreateRoomOpts | typeof CreateBigRoomOpts | typeof UpdateRoomOpts | typeof UpdateBigRoomOpts,
>(
  schema: Schema,
  { password, ...rest }: Static<Schema>,
): string | Static<Schema> => {
  const opts: Static<Schema> = { ...rest };
  if (password) opts.password = password.trim();

  if (!Value.Check(schema, opts)) {
    const fields = new Set(
      [...Value.Errors(schema, opts)].map((ve) => {
        debug(`${ve.path}: ${ve.message} (${ve.value})`);
        return ve.path.slice(1);
      }),
    );
    return `Invalid ${[...fields.values()].join(', ')}`;
  }

  return opts;
};
