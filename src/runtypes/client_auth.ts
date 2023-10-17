import { Static, Type as T } from '@sinclair/typebox';

export enum AuthProvider {
  Twitch = 'twitch',
}

export const ClientAuth = T.Object({
  preferred_username: T.String(),
  sub: T.String(), // twitch user id
  profile_image_url: T.String(),
  provider: T.Enum(AuthProvider),
  iat: T.Number(), // issued at; epoch, in seconds
  exp: T.Number(), // expires; epoch, in seconds
});
export type ClientAuth = Static<typeof ClientAuth>;
