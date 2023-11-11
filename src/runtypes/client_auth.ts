import { Static, Type as T } from '@sinclair/typebox';

export enum AuthProvider {
  Twitch = 'twitch',
}

export const JWT = T.Object({
  sub: T.String(), // twitch user id
  iat: T.Number(), // issued at; epoch, in seconds
  exp: T.Number(), // expires; epoch, in seconds
});
export type JWT = Static<typeof JWT>;

export const NTAuth = T.Object({
  preferred_username: T.String(),
  profile_image_url: T.String(),
  provider: T.Enum(AuthProvider),
});
export type NTAuth = Static<typeof NTAuth>;

export const ClientAuth = T.Composite([JWT, NTAuth]);
export type ClientAuth = Static<typeof ClientAuth>;
