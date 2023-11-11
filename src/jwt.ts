import jwt from 'jsonwebtoken';
import { Value } from '@sinclair/typebox/value';

import { ClientAuth, NTAuth } from './runtypes/client_auth';

export const createJwtFns = (jwtSecret: string, jwtRefresh: string) => {
  const verifyToken = (token: string): Promise<ClientAuth> =>
    new Promise((resolve, reject) => {
      jwt.verify(token, jwtSecret, (err, decoded: unknown) => {
        if (err) {
          reject(new Error(`JWT verification failed: ${err.message}`));
          return;
        }

        if (Value.Check(ClientAuth, decoded)) {
          resolve(decoded);
          return;
        }

        const errs = [...Value.Errors(ClientAuth, decoded)].map((ve) => `${ve.path}: ${ve.message}`);
        console.error('JWT validated, but contents were unexpected', errs);
        reject(new Error(`JWT validation failed`));
      });
    });

  const signToken = (userId: string, auth: NTAuth): Promise<string> =>
    new Promise((resolve, reject) => {
      jwt.sign(auth, jwtSecret, { subject: userId }, (err, jwt) => {
        if (err !== null) reject(err);
        else if (jwt === undefined) reject('No error, but undefined jwt');
        else resolve(jwt);
      });
    });

  return { signToken, verifyToken };
};
