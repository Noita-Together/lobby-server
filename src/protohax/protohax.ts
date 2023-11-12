export const enum Wiretype {
  VARINT = 0,
  I64 = 1,
  LEN = 2,
  SGROUP = 3,
  EGROUP = 4,
  I32 = 5,
}

export const enum DigResult {
  SUCCESS = 0,
  NOT_FOUND = 1,
  ERROR = 2,
}

export const EMPTY_BUFFER = Buffer.of();

type Packable = keyof ProtoHax &
  (
    | 'Int32'
    | 'Int64'
    | 'Uint32'
    | 'Uint64'
    | 'Bool'
    | 'Enum'
    | 'Sint32'
    | 'Sint64'
    | 'Sfixed32'
    | 'Fixed32'
    | 'Float'
    | 'Sfixed64'
    | 'Fixed64'
    | 'Double'
  );
type Unpacked<T extends Packable> = ProtoHax[T] extends () => infer P ? P : never;

/**
 * Read selected values from a serialized protocol buffer message. Used to optimize
 * the processing time of PlayerMove messages.
 */
export class ProtoHax {
  private pos: number = 0;
  private last: number = 0;
  private end: number;
  private ok: boolean;

  constructor(private buf: Buffer) {
    this.end = buf.length;
    this.ok = this.pos < this.end;
  }

  atEnd() {
    return this.pos >= this.end;
  }

  private varint(): void {
    if (!this.ok) return;

    this.last = 0;

    // read up to 4 bytes of a varint (bitwise-safe value up to 28 bits of payload)
    for (var b = 0, shift = 0; shift < 28; shift += 7) {
      b = this.buf[this.pos++];
      this.last |= (b & 0x7f) << shift;

      if ((b & 0x80) === 0) return; // we hit the end of the varint
    }

    // if we still have bytes to read, we failed
    this.ok = (b & 0x80) === 0;
  }

  private skipVarint() {
    if (!this.ok) return;

    // varints can be up to 10 bytes, representing up to a 64-bit unsigned int
    for (var i = 0; i < 10; i++) {
      if ((this.buf[this.pos++] & 0x80) === 0) return;
    }

    // we read 10 bytes all with an MSB of 1, we weren't at a valid varint
    this.ok = false;
  }

  // skip the specified number of bytes
  private skipBytes(bytes: number) {
    this.pos += bytes;
  }

  private skipGroup(sgroup: number) {
    var until = sgroup ^ (Wiretype.EGROUP ^ Wiretype.SGROUP);
    do {
      this.skip(); // skip the current tag's payload
      this.varint(); // read the next tag
    } while (this.ok && this.last !== until);
  }

  // skip over a payload. the tag should be in `this.last`
  private skip() {
    if (!this.ok) return;

    // prettier-ignore
    switch (this.last & 0x07) {
      // VARINT: int32, int64, uint32, uint64, sint32, sint64, bool, enum
      case Wiretype.VARINT: this.skipVarint(); break;
      // I64: fixed64, sfixed64, double
      case Wiretype.I64: this.skipBytes(8); break;
      // LEN: string, bytes, embedded messages, packed repeated fields
      case Wiretype.LEN: this.varint(); this.skipBytes(this.last); break;
      // SGROUP: group start (deprecated)
      case Wiretype.SGROUP: this.skipGroup(this.last); break;
      // EGROUP: group end (deprecated)
      case Wiretype.EGROUP: break;
      // I32: fixed32, sfixed32, float
      case Wiretype.I32: this.skipBytes(4); break;
      default: throw new Error('Invalid wire type: '+(this.last&0x07));
    }

    this.ok = this.pos < this.buf.length;
  }

  private readVarint32(): number {
    this.varint();

    // if varint succeeded, the value was read in <= 4 bytes and we can just
    // return and call it a day
    if (this.ok) return this.last >>> 0;

    // we've read 4 out of a possible 10 bytes so far. the worst case is -1, which will be
    // 9* 0xff followed by 0x01. There are four remaining bits that might have meaning to
    // us, and the rest can be ignored since we're only reading a 32 bit number.
    //
    // even though the wiretype of this varint knows it's a 32 bit number, it still records
    // all 64 bits. it's unclear whether that is sane behavior, but because the data is
    // recorded as little-endian, it has the effect that very large negative values stored
    // as int32 will be smaller in their varint encoding. see:
    // https://github.com/protocolbuffers/protobuf-javascript/blob/8730ba5e0f5153c5889c356193d93778c6300932/binary/encoder.js#L145-L172
    //
    // either way, we have to deal with the data we could potentially receive.

    // read the 5th byte
    var b = this.buf[this.pos++];
    this.ok = (b & 0x80) === 0;

    // store the last 4 bits of the 5th input byte in the top 4 bits of the value
    // ____aaaa aaabbbbb bbcccccc cddddddd
    //                            0___eeee
    // eeee____ ________ ________ ________
    this.last |= (b & 0x0f) << 28;

    // consume up to 5 more bytes of varint and discard them
    for (var i = 0; !this.ok && i < 5; i++) {
      b = this.buf[this.pos++];
      this.ok = (b & 0x80) === 0;
    }

    if (!this.ok) throw new Error('VARINT read failed');

    // return as unsigned
    return this.last >>> 0;
  }

  private readVarint64(): bigint {
    if (!this.ok) return 0n;
    this.varint();

    var big = BigInt(this.last);
    if (this.ok) return big;

    // it's a big one, read the rest. this could probably be
    // done more efficiently by working with in 32 bit space
    // as regular js numbers. however, that's a pain and i'm
    // just looking for something that clearly works for now
    for (var b = 0, shift = 28n; shift < 70n; shift += 7n) {
      b = this.buf[this.pos++];
      big |= (BigInt(b) & 0x7fn) << shift;

      if ((b & 0x80) === 0) break; // we hit the end of the varint
    }

    this.ok = (b & 0x80) === 0;
    if (!this.ok) throw new Error('VARINT64 read failed');

    // we can technically construct >64bit values; we rely on
    // the calling functions to interpret and truncate the data
    return big & 0xffffffffffffffffn;
  }

  // varint     := int32 | int64 | uint32 | uint64 | bool | enum | sint32 | sint64;
  //                 encoded as varints (sintN are ZigZag-encoded first)
  Int32(): number {
    if (!this.ok) return 0;
    return this.readVarint32() | 0;
  }
  Int64(): bigint {
    if (!this.ok) return 0n;
    return BigInt.asIntN(64, this.readVarint64());
  }
  Uint32(): number {
    if (!this.ok) return 0;
    return this.readVarint32() >>> 0;
  }
  Uint64(): bigint {
    if (!this.ok) return 0n;
    return BigInt.asUintN(64, this.readVarint64());
  }
  Bool(): boolean {
    if (!this.ok) return false;
    var val = this.readVarint32();
    switch (val) {
      case 0:
        return false;
      case 1:
        return true;
      default:
        throw new Error('Invalid boolean value');
    }
  }
  Enum(): number {
    if (!this.ok) return 0;
    var val = this.readVarint32();
    return val;
  }
  Sint32(): number {
    if (!this.ok) return 0;
    var zze = this.readVarint32();
    return (zze >>> 1) ^ -(zze & 1);
  }
  Sint64(): bigint {
    if (!this.ok) return 0n;
    var zze = this.readVarint64();
    return (zze >> 1n) ^ -(zze & 1n);
  }

  // i32        := sfixed32 | fixed32 | float;
  //                 encoded as 4-byte little-endian;
  //                 memcpy of the equivalent C types (u?int32_t, float)
  Sfixed32(): number {
    if (!this.ok || this.pos > this.end - 4) return 0;
    var val = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return val;
  }
  Fixed32(): number {
    if (!this.ok || this.pos > this.end - 4) return 0;
    var val = this.buf.readUint32LE(this.pos);
    this.pos += 4;
    return val;
  }
  Float(): number {
    if (!this.ok || this.pos > this.end - 4) return 0;
    var val = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return val;
  }

  // i64        := sfixed64 | fixed64 | double;
  //                 encoded as 8-byte little-endian;
  //                 memcpy of the equivalent C types (u?int64_t, double)
  Sfixed64(): bigint {
    if (!this.ok || this.pos > this.end - 8) return 0n;
    var val = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return val;
  }
  Fixed64(): bigint {
    if (!this.ok || this.pos > this.end - 8) return 0n;
    var val = this.buf.readBigUint64LE(this.pos);
    this.pos += 8;
    return val;
  }
  Double(): number {
    if (!this.ok || this.pos > this.end - 8) return 0;
    var val = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return val;
  }

  // len-prefix := size (message | string | bytes | packed);
  //                 size encoded as int32 varint
  Bytes(): Buffer {
    if (!this.ok) return EMPTY_BUFFER;
    return this.buf.subarray(this.pos, this.end);
  }

  String(): string {
    if (!this.ok) return '';
    return this.buf.toString('utf-8', this.pos, this.end);
  }

  // Only repeated fields of primitive numeric types can be declared "packed".
  // These are types that would normally use the VARINT, I32, or I64 wire types.
  Packed<const T extends Packable>(type: T): Unpacked<T>[] {
    var arr: Unpacked<T>[] = [];
    while (this.ok && this.pos < this.end) {
      arr.push(this[type]() as Unpacked<T>);
    }
    if (!this.ok) throw new Error('packed read failed');
    return arr;
  }

  private seek(fieldId: number) {
    if (!this.ok) return;
    this.varint();
    while (this.last >>> 3 !== fieldId) {
      this.skip();
      if (!this.ok) break;
      this.varint();
    }
  }

  private size(): number {
    switch ((this.last & 0x07) as Wiretype) {
      case Wiretype.VARINT:
        return 0;
      case Wiretype.I64:
        return 8;
      case Wiretype.I32:
        return 4;
      case Wiretype.LEN:
        return this.readVarint32();
      // can't know the size of groups without reading them, and
      // we don't really care.
      case Wiretype.SGROUP:
      case Wiretype.EGROUP:
        throw new Error('not implemented');
    }
  }

  /**
   * Seek to the next instance of fieldId, which must be a LEN wiretype,
   * and rescope this instance to its payload
   */
  with(fieldId: number): ProtoHax {
    this.seek(fieldId);
    if (!this.ok) return this;
    var size = this.size();
    this.end = size ? this.pos + size : this.end;
    return this;
  }

  /**
   * Find the next instance of the specified fieldId, and call the callback
   * with a new ProtoHax instance if found.
   */
  if(fieldId: number, cb: (phax: ProtoHax) => void): ProtoHax {
    if (!this.ok) return this;
    this.seek(fieldId);
    if (!this.ok) return this;
    var size = this.size();
    var val;
    if (size > 0) {
      val = this.buf.subarray(this.pos, this.pos + size);
      // move the pointer forward by the size of the payload
      this.pos += size;
    } else {
      val = this.buf.subarray(this.pos);
      // we're assuming here that size=0 is a varint, and everything
      // else (that doesn't throw an error) has a size that's known
      // up-front. therefore, in order to move our position pointer
      // forward, all we have to do here is skip a varint
      this.skipVarint();
    }
    if (this.ok) cb(new ProtoHax(val));
    this.ok = this.pos < this.end;
    return this;
  }

  /**
   * Find all instances of the specified fieldId and call the callback
   * with a new ProtoHax instance for each.
   */
  each(fieldId: number, cb: (phax: ProtoHax) => void): ProtoHax {
    while (this.ok) {
      this.if(fieldId, cb);
      // this.skip();
    }
    return this;
  }
}
