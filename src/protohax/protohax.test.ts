import { Enum, Message } from './fixtures/protohax_pb';
import { ProtoHax } from './protohax';

describe('ProtoHax', () => {
  describe('single numeric values', () => {
    type proto_scalar = number | bigint | boolean | Enum;
    type messageScalar = { [K in keyof Message as Message[K] extends proto_scalar | proto_scalar[] ? K : never]: K };
    type messageScalars = messageScalar[keyof messageScalar] & keyof Message;

    type fakeBigint<T> = T extends bigint ? string : T extends bigint[] ? string[] : T;

    const scalar = <T extends messageScalars>(key: T, value: fakeBigint<Message[T]>) => ({ key, value });

    type phaxReadMethod = {
      [K in keyof ProtoHax as ProtoHax[K] extends () => proto_scalar | proto_scalar[] ? K : never]: K;
    };
    type phaxReadMethods = phaxReadMethod[keyof phaxReadMethod] & keyof ProtoHax;

    const asSingle = (v: number) => {
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(v, 0);
      return buf.readFloatBE(0);
    };

    const methodNames: Record<string, phaxReadMethods> = {
      singleInt32: 'Int32',
      singleUint32: 'Uint32',
      singleSint32: 'Sint32',
      singleFixed32: 'Fixed32',
      singleSfixed32: 'Sfixed32',
      singleFloat: 'Float',
      singleDouble: 'Double',
      singleInt64: 'Int64',
      singleUint64: 'Uint64',
      singleSint64: 'Sint64',
      singleFixed64: 'Fixed64',
      singleSfixed64: 'Sfixed64',
      singleBool: 'Bool',
      singleEnum: 'Enum',
    };

    // prettier-ignore
    const tests: {key: keyof Message, value: any}[] = [
      // small negatives
      scalar('singleInt32',     -1 ), // TODO: deal with reading negative varints when we expect 32 bits (but the encoder wrote 64 bits)
      scalar('singleSint32',    -1            ),
      scalar('singleSfixed32',  -1            ),
      scalar('singleFloat',     asSingle(-1.1)),
      scalar('singleDouble',    -1.1          ),
      scalar('singleInt64',    '-1'           ),
      scalar('singleSint64',   '-1'           ),
      scalar('singleSfixed64', '-1'           ),

      // zero
      scalar('singleInt32',     0 ),
      scalar('singleUint32',    0 ),
      scalar('singleSint32',    0 ),
      scalar('singleFixed32',   0 ),
      scalar('singleSfixed32',  0 ),
      scalar('singleFloat',     0 ),
      scalar('singleDouble',    0 ),
      scalar('singleInt64',    '0'),
      scalar('singleUint64',   '0'),
      scalar('singleSint64',   '0'),
      scalar('singleFixed64',  '0'),
      scalar('singleSfixed64', '0'),

      // one
      scalar('singleInt32',     1            ),
      scalar('singleUint32',    1            ),
      scalar('singleSint32',    1            ),
      scalar('singleFixed32',   1            ),
      scalar('singleSfixed32',  1            ),
      scalar('singleFloat',     asSingle(1.1)),
      scalar('singleDouble',    1.1          ),
      scalar('singleInt64',    '1'           ),
      scalar('singleUint64',   '1'           ),
      scalar('singleSint64',   '1'           ),
      scalar('singleFixed64',  '1'           ), 
      scalar('singleSfixed64', '1'           ),

      // varint edges
      scalar('singleInt32', 1<<30),
      scalar('singleInt64', (0b01100110_10110010_10010111_01011001_10100110_11001001_10111010_00110011n).toString()),

      // booleans
      scalar('singleBool', true),
      scalar('singleBool', false),

      // enums
      scalar('singleEnum', Enum.UNSPECIFIED),
      scalar('singleEnum', Enum.ONE),
      scalar('singleEnum', Enum.TWO),
    ];

    it.each(tests)('$key $value', ({ key, value }) => {
      const n = typeof value === 'string' ? BigInt(value) : value;
      const pbes_encoded = Buffer.from(
        new Message({
          [key]: n,
        }).toBinary()
      );

      const fieldId = Message.fields.findJsonName(key)?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);
      const readMethod = methodNames[key];
      expect(readMethod).not.toBeUndefined();

      const res = phax.with(fieldId!)[readMethod!]();
      expect(res.toString()).toEqual(n.toString());
    });
  });

  describe('packed repeated', () => {
    it('reads with .Packed()', () => {
      const expected = [1, 2, 3];
      const pbes_encoded = Buffer.from(new Message({ repeatedInt32: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('repeatedInt32')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      const actual = phax.with(fieldId!).Packed('Int32');
      expect(actual).toEqual(expected);
    });
    it('reads with value readers', () => {
      const expected = [1, 2, 3];
      const pbes_encoded = Buffer.from(new Message({ repeatedInt32: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('repeatedInt32')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      let actual: number[] = [];
      phax.if(fieldId!, phax => {
        while (!phax.atEnd()) {
          actual.push(phax.Int32());
        }
      });
      expect(actual).toEqual(expected);
    });
  });

  describe('length-delimited', () => {
    it('reads a string', () => {
      const expected = 'hi there ☃';
      const pbes_encoded = Buffer.from(new Message({ singleString: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('singleString')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      const actual = phax.with(fieldId!).String();

      expect(expected).toEqual(actual);
    });
    it('reads bytes', () => {
      const expected = Buffer.from('hi there ☃');
      const pbes_encoded = Buffer.from(new Message({ singleBytes: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('singleBytes')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      const actual = phax.with(fieldId!).Bytes();

      expect(expected).toEqual(actual);
    });
    it('reads messages', () => {
      const pbes_encoded = Buffer.from(
        new Message({
          lMessage: {
            singleBool: true,
          },
          repeatedMessage: [{ singleEnum: Enum.ONE }, { singleEnum: Enum.TWO }],
        }).toBinary()
      );

      const lMessage = Message.fields.findJsonName('lMessage')?.no;
      expect(lMessage).not.toBeUndefined();
      const singleBool = Message.fields.findJsonName('singleBool')?.no;
      expect(singleBool).not.toBeUndefined();
      const repeatedMessage = Message.fields.findJsonName('repeatedMessage')?.no;
      expect(repeatedMessage).not.toBeUndefined();
      const singleEnum = Message.fields.findJsonName('singleEnum')?.no;
      expect(singleEnum).not.toBeUndefined();

      const expected = [true, Enum.ONE, Enum.TWO];
      const actual: [boolean, number, number] = [] as any;

      actual.push(
        new ProtoHax(pbes_encoded) //
          .with(lMessage!)
          .with(singleBool!)
          .Bool()
      );

      new ProtoHax(pbes_encoded) //
        .each(repeatedMessage!, phax => actual.push(phax.with(singleEnum!).Enum()));

      expect(actual).toEqual(expected);
    });
  });

  describe('each', () => {
    it('reads scalars', () => {
      const expected = [1, 2, 3];
      const pbes_encoded = Buffer.from(new Message({ unpackedInt32: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('unpackedInt32')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      let actual: number[] = [];
      phax.each(fieldId!, phax => actual.push(phax.Int32()));
      expect(actual).toEqual(expected);
    });
    it('reads strings', () => {
      const expected = ['a', 'b'];
      const pbes_encoded = Buffer.from(new Message({ repeatedString: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('repeatedString')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      const actual: string[] = [];
      phax.each(fieldId!, phax => actual.push(phax.String()));

      expect(expected).toEqual(actual);
    });
    it('reads bytes', () => {
      const expected = ['a', 'b'].map(s => Buffer.from(s));
      const pbes_encoded = Buffer.from(new Message({ repeatedBytes: expected }).toBinary());

      const fieldId = Message.fields.findJsonName('repeatedBytes')?.no;
      expect(fieldId).not.toBeUndefined();

      const phax = new ProtoHax(pbes_encoded);

      const actual: Buffer[] = [];
      phax.each(fieldId!, phax => actual.push(phax.Bytes()));

      expect(expected).toEqual(actual);
    });
  });
  describe('skip', () => {
    it('can skip over everything', () => {
      const pbes_encoded = Buffer.from(
        new Message({
          lMessage: new Message({ singleDouble: 1 }),
          singleInt32: 1,
          singleInt64: 1n,
          singleUint32: 1,
          singleUint64: 1n,
          singleSint32: 1,
          singleSint64: 1n,
          singleBool: true,
          singleEnum: Enum.ONE,
          singleFixed64: 1n,
          singleSfixed64: 1n,
          singleDouble: 1,
          singleString: 'hi',
          singleBytes: Buffer.from('hi'),
          singleFixed32: 1,
          singleSfixed32: 1,
          singleFloat: 1,
          singleMessage: new Message({ singleDouble: 1 }),
          repeatedInt32: [1],
          repeatedString: ['hi'],
          repeatedBytes: [Buffer.from('hi')],
          repeatedMessage: [new Message({ singleDouble: 1 })],
          unpackedInt32: [1],
        }).toBinary()
      );
      const phax = new ProtoHax(pbes_encoded);
      phax.if(1337, phax => {
        throw new Error('should not be called');
      });
    });
  });

  describe('empty values', () => {
    it('returns defaults', () => {
      const empty = Buffer.of();
      expect(new ProtoHax(empty).String()).toEqual('');
      expect(new ProtoHax(empty).Bytes()).toEqual(empty);
      expect(new ProtoHax(empty).Int32()).toEqual(0);
      expect(new ProtoHax(empty).Enum()).toEqual(0);
      expect(new ProtoHax(empty).Bool()).toEqual(false);
    });
  });
});
