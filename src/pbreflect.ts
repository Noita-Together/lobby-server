import def from './gen/pbjs_pb.json';

const NT = def.nested.NT.nested;

type FieldList = { [key: string]: { type: string; id: number } };
type FieldIds<T extends FieldList> = { [K in keyof T]: T[K]['id'] } & unknown;
type MessageIds<T extends { [key in keyof T]: { fields: FieldList } }> = {
  [K in keyof T]: FieldIds<T[K]['fields']>;
} & unknown;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

export const Messages: MessageIds<typeof NT> = Object.create(null) as any;
for (const [msgName, defs] of Object.entries(NT) as [keyof typeof NT, (typeof NT)[keyof typeof NT]][]) {
  if (!defs.fields) continue;

  const fields: UnionToIntersection<FieldIds<typeof defs.fields>> = Object.create(null) as any;
  for (const [fieldName, nameid] of Object.entries(defs.fields) as [keyof typeof fields, { id: number }][]) {
    fields[fieldName] = nameid.id;
  }
  Messages[msgName] = fields;
}

export const gameActions = Object.keys(
  def.nested.NT.nested.GameAction.fields,
) as (keyof typeof def.nested.NT.nested.GameAction.fields)[];
export const lobbyActions = Object.keys(
  def.nested.NT.nested.LobbyAction.fields,
) as (keyof typeof def.nested.NT.nested.LobbyAction.fields)[];
