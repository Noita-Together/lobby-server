/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

/**
 * Enum enum.
 * @exports Enum
 * @enum {number}
 * @property {number} ENUM_UNSPECIFIED=0 ENUM_UNSPECIFIED value
 * @property {number} ENUM_ONE=1 ENUM_ONE value
 * @property {number} ENUM_TWO=2 ENUM_TWO value
 */
export const Enum = $root.Enum = (() => {
    const valuesById = {}, values = Object.create(valuesById);
    values[valuesById[0] = "ENUM_UNSPECIFIED"] = 0;
    values[valuesById[1] = "ENUM_ONE"] = 1;
    values[valuesById[2] = "ENUM_TWO"] = 2;
    return values;
})();

export const Message = $root.Message = (() => {

    /**
     * Properties of a Message.
     * @exports IMessage
     * @interface IMessage
     * @property {IMessage|null} [lMessage] Message lMessage
     * @property {number|null} [singleInt32] Message singleInt32
     * @property {number|Long|null} [singleInt64] Message singleInt64
     * @property {number|null} [singleUint32] Message singleUint32
     * @property {number|Long|null} [singleUint64] Message singleUint64
     * @property {number|null} [singleSint32] Message singleSint32
     * @property {number|Long|null} [singleSint64] Message singleSint64
     * @property {boolean|null} [singleBool] Message singleBool
     * @property {Enum|null} [singleEnum] Message singleEnum
     * @property {number|Long|null} [singleFixed64] Message singleFixed64
     * @property {number|Long|null} [singleSfixed64] Message singleSfixed64
     * @property {number|null} [singleDouble] Message singleDouble
     * @property {string|null} [singleString] Message singleString
     * @property {Uint8Array|null} [singleBytes] Message singleBytes
     * @property {number|null} [singleFixed32] Message singleFixed32
     * @property {number|null} [singleSfixed32] Message singleSfixed32
     * @property {number|null} [singleFloat] Message singleFloat
     * @property {IMessage|null} [singleMessage] Message singleMessage
     * @property {Array.<number>|null} [repeatedInt32] Message repeatedInt32
     * @property {Array.<string>|null} [repeatedString] Message repeatedString
     * @property {Array.<Uint8Array>|null} [repeatedBytes] Message repeatedBytes
     * @property {Array.<IMessage>|null} [repeatedMessage] Message repeatedMessage
     * @property {Array.<number>|null} [unpackedInt32] Message unpackedInt32
     */

    /**
     * Constructs a new Message.
     * @exports Message
     * @classdesc Represents a Message.
     * @implements IMessage
     * @constructor
     * @param {IMessage=} [properties] Properties to set
     */
    function Message(properties) {
        this.repeatedInt32 = [];
        this.repeatedString = [];
        this.repeatedBytes = [];
        this.repeatedMessage = [];
        this.unpackedInt32 = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * Message lMessage.
     * @member {IMessage|null|undefined} lMessage
     * @memberof Message
     * @instance
     */
    Message.prototype.lMessage = null;

    /**
     * Message singleInt32.
     * @member {number} singleInt32
     * @memberof Message
     * @instance
     */
    Message.prototype.singleInt32 = 0;

    /**
     * Message singleInt64.
     * @member {number|Long} singleInt64
     * @memberof Message
     * @instance
     */
    Message.prototype.singleInt64 = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Message singleUint32.
     * @member {number} singleUint32
     * @memberof Message
     * @instance
     */
    Message.prototype.singleUint32 = 0;

    /**
     * Message singleUint64.
     * @member {number|Long} singleUint64
     * @memberof Message
     * @instance
     */
    Message.prototype.singleUint64 = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

    /**
     * Message singleSint32.
     * @member {number} singleSint32
     * @memberof Message
     * @instance
     */
    Message.prototype.singleSint32 = 0;

    /**
     * Message singleSint64.
     * @member {number|Long} singleSint64
     * @memberof Message
     * @instance
     */
    Message.prototype.singleSint64 = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Message singleBool.
     * @member {boolean} singleBool
     * @memberof Message
     * @instance
     */
    Message.prototype.singleBool = false;

    /**
     * Message singleEnum.
     * @member {Enum} singleEnum
     * @memberof Message
     * @instance
     */
    Message.prototype.singleEnum = 0;

    /**
     * Message singleFixed64.
     * @member {number|Long} singleFixed64
     * @memberof Message
     * @instance
     */
    Message.prototype.singleFixed64 = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Message singleSfixed64.
     * @member {number|Long} singleSfixed64
     * @memberof Message
     * @instance
     */
    Message.prototype.singleSfixed64 = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Message singleDouble.
     * @member {number} singleDouble
     * @memberof Message
     * @instance
     */
    Message.prototype.singleDouble = 0;

    /**
     * Message singleString.
     * @member {string} singleString
     * @memberof Message
     * @instance
     */
    Message.prototype.singleString = "";

    /**
     * Message singleBytes.
     * @member {Uint8Array} singleBytes
     * @memberof Message
     * @instance
     */
    Message.prototype.singleBytes = $util.newBuffer([]);

    /**
     * Message singleFixed32.
     * @member {number} singleFixed32
     * @memberof Message
     * @instance
     */
    Message.prototype.singleFixed32 = 0;

    /**
     * Message singleSfixed32.
     * @member {number} singleSfixed32
     * @memberof Message
     * @instance
     */
    Message.prototype.singleSfixed32 = 0;

    /**
     * Message singleFloat.
     * @member {number} singleFloat
     * @memberof Message
     * @instance
     */
    Message.prototype.singleFloat = 0;

    /**
     * Message singleMessage.
     * @member {IMessage|null|undefined} singleMessage
     * @memberof Message
     * @instance
     */
    Message.prototype.singleMessage = null;

    /**
     * Message repeatedInt32.
     * @member {Array.<number>} repeatedInt32
     * @memberof Message
     * @instance
     */
    Message.prototype.repeatedInt32 = $util.emptyArray;

    /**
     * Message repeatedString.
     * @member {Array.<string>} repeatedString
     * @memberof Message
     * @instance
     */
    Message.prototype.repeatedString = $util.emptyArray;

    /**
     * Message repeatedBytes.
     * @member {Array.<Uint8Array>} repeatedBytes
     * @memberof Message
     * @instance
     */
    Message.prototype.repeatedBytes = $util.emptyArray;

    /**
     * Message repeatedMessage.
     * @member {Array.<IMessage>} repeatedMessage
     * @memberof Message
     * @instance
     */
    Message.prototype.repeatedMessage = $util.emptyArray;

    /**
     * Message unpackedInt32.
     * @member {Array.<number>} unpackedInt32
     * @memberof Message
     * @instance
     */
    Message.prototype.unpackedInt32 = $util.emptyArray;

    /**
     * Creates a new Message instance using the specified properties.
     * @function create
     * @memberof Message
     * @static
     * @param {IMessage=} [properties] Properties to set
     * @returns {Message} Message instance
     */
    Message.create = function create(properties) {
        return new Message(properties);
    };

    /**
     * Encodes the specified Message message. Does not implicitly {@link Message.verify|verify} messages.
     * @function encode
     * @memberof Message
     * @static
     * @param {IMessage} message Message message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    Message.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.lMessage != null && Object.hasOwnProperty.call(message, "lMessage"))
            $root.Message.encode(message.lMessage, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        if (message.singleInt32 != null && Object.hasOwnProperty.call(message, "singleInt32"))
            writer.uint32(/* id 11, wireType 0 =*/88).int32(message.singleInt32);
        if (message.singleInt64 != null && Object.hasOwnProperty.call(message, "singleInt64"))
            writer.uint32(/* id 12, wireType 0 =*/96).int64(message.singleInt64);
        if (message.singleUint32 != null && Object.hasOwnProperty.call(message, "singleUint32"))
            writer.uint32(/* id 13, wireType 0 =*/104).uint32(message.singleUint32);
        if (message.singleUint64 != null && Object.hasOwnProperty.call(message, "singleUint64"))
            writer.uint32(/* id 14, wireType 0 =*/112).uint64(message.singleUint64);
        if (message.singleSint32 != null && Object.hasOwnProperty.call(message, "singleSint32"))
            writer.uint32(/* id 15, wireType 0 =*/120).sint32(message.singleSint32);
        if (message.singleSint64 != null && Object.hasOwnProperty.call(message, "singleSint64"))
            writer.uint32(/* id 16, wireType 0 =*/128).sint64(message.singleSint64);
        if (message.singleBool != null && Object.hasOwnProperty.call(message, "singleBool"))
            writer.uint32(/* id 17, wireType 0 =*/136).bool(message.singleBool);
        if (message.singleEnum != null && Object.hasOwnProperty.call(message, "singleEnum"))
            writer.uint32(/* id 18, wireType 0 =*/144).int32(message.singleEnum);
        if (message.singleFixed64 != null && Object.hasOwnProperty.call(message, "singleFixed64"))
            writer.uint32(/* id 19, wireType 1 =*/153).fixed64(message.singleFixed64);
        if (message.singleSfixed64 != null && Object.hasOwnProperty.call(message, "singleSfixed64"))
            writer.uint32(/* id 20, wireType 1 =*/161).sfixed64(message.singleSfixed64);
        if (message.singleDouble != null && Object.hasOwnProperty.call(message, "singleDouble"))
            writer.uint32(/* id 21, wireType 1 =*/169).double(message.singleDouble);
        if (message.singleString != null && Object.hasOwnProperty.call(message, "singleString"))
            writer.uint32(/* id 22, wireType 2 =*/178).string(message.singleString);
        if (message.singleBytes != null && Object.hasOwnProperty.call(message, "singleBytes"))
            writer.uint32(/* id 23, wireType 2 =*/186).bytes(message.singleBytes);
        if (message.singleFixed32 != null && Object.hasOwnProperty.call(message, "singleFixed32"))
            writer.uint32(/* id 24, wireType 5 =*/197).fixed32(message.singleFixed32);
        if (message.singleSfixed32 != null && Object.hasOwnProperty.call(message, "singleSfixed32"))
            writer.uint32(/* id 25, wireType 5 =*/205).sfixed32(message.singleSfixed32);
        if (message.singleFloat != null && Object.hasOwnProperty.call(message, "singleFloat"))
            writer.uint32(/* id 26, wireType 5 =*/213).float(message.singleFloat);
        if (message.singleMessage != null && Object.hasOwnProperty.call(message, "singleMessage"))
            $root.Message.encode(message.singleMessage, writer.uint32(/* id 27, wireType 2 =*/218).fork()).ldelim();
        if (message.repeatedInt32 != null && message.repeatedInt32.length) {
            writer.uint32(/* id 111, wireType 2 =*/890).fork();
            for (let i = 0; i < message.repeatedInt32.length; ++i)
                writer.int32(message.repeatedInt32[i]);
            writer.ldelim();
        }
        if (message.repeatedString != null && message.repeatedString.length)
            for (let i = 0; i < message.repeatedString.length; ++i)
                writer.uint32(/* id 122, wireType 2 =*/978).string(message.repeatedString[i]);
        if (message.repeatedBytes != null && message.repeatedBytes.length)
            for (let i = 0; i < message.repeatedBytes.length; ++i)
                writer.uint32(/* id 123, wireType 2 =*/986).bytes(message.repeatedBytes[i]);
        if (message.repeatedMessage != null && message.repeatedMessage.length)
            for (let i = 0; i < message.repeatedMessage.length; ++i)
                $root.Message.encode(message.repeatedMessage[i], writer.uint32(/* id 127, wireType 2 =*/1018).fork()).ldelim();
        if (message.unpackedInt32 != null && message.unpackedInt32.length)
            for (let i = 0; i < message.unpackedInt32.length; ++i)
                writer.uint32(/* id 211, wireType 0 =*/1688).int32(message.unpackedInt32[i]);
        return writer;
    };

    /**
     * Encodes the specified Message message, length delimited. Does not implicitly {@link Message.verify|verify} messages.
     * @function encodeDelimited
     * @memberof Message
     * @static
     * @param {IMessage} message Message message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    Message.encodeDelimited = function encodeDelimited(message, writer) {
        return this.encode(message, writer).ldelim();
    };

    /**
     * Decodes a Message message from the specified reader or buffer.
     * @function decode
     * @memberof Message
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {Message} Message
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    Message.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.Message();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.lMessage = $root.Message.decode(reader, reader.uint32());
                    break;
                }
            case 11: {
                    message.singleInt32 = reader.int32();
                    break;
                }
            case 12: {
                    message.singleInt64 = reader.int64();
                    break;
                }
            case 13: {
                    message.singleUint32 = reader.uint32();
                    break;
                }
            case 14: {
                    message.singleUint64 = reader.uint64();
                    break;
                }
            case 15: {
                    message.singleSint32 = reader.sint32();
                    break;
                }
            case 16: {
                    message.singleSint64 = reader.sint64();
                    break;
                }
            case 17: {
                    message.singleBool = reader.bool();
                    break;
                }
            case 18: {
                    message.singleEnum = reader.int32();
                    break;
                }
            case 19: {
                    message.singleFixed64 = reader.fixed64();
                    break;
                }
            case 20: {
                    message.singleSfixed64 = reader.sfixed64();
                    break;
                }
            case 21: {
                    message.singleDouble = reader.double();
                    break;
                }
            case 22: {
                    message.singleString = reader.string();
                    break;
                }
            case 23: {
                    message.singleBytes = reader.bytes();
                    break;
                }
            case 24: {
                    message.singleFixed32 = reader.fixed32();
                    break;
                }
            case 25: {
                    message.singleSfixed32 = reader.sfixed32();
                    break;
                }
            case 26: {
                    message.singleFloat = reader.float();
                    break;
                }
            case 27: {
                    message.singleMessage = $root.Message.decode(reader, reader.uint32());
                    break;
                }
            case 111: {
                    if (!(message.repeatedInt32 && message.repeatedInt32.length))
                        message.repeatedInt32 = [];
                    if ((tag & 7) === 2) {
                        let end2 = reader.uint32() + reader.pos;
                        while (reader.pos < end2)
                            message.repeatedInt32.push(reader.int32());
                    } else
                        message.repeatedInt32.push(reader.int32());
                    break;
                }
            case 122: {
                    if (!(message.repeatedString && message.repeatedString.length))
                        message.repeatedString = [];
                    message.repeatedString.push(reader.string());
                    break;
                }
            case 123: {
                    if (!(message.repeatedBytes && message.repeatedBytes.length))
                        message.repeatedBytes = [];
                    message.repeatedBytes.push(reader.bytes());
                    break;
                }
            case 127: {
                    if (!(message.repeatedMessage && message.repeatedMessage.length))
                        message.repeatedMessage = [];
                    message.repeatedMessage.push($root.Message.decode(reader, reader.uint32()));
                    break;
                }
            case 211: {
                    if (!(message.unpackedInt32 && message.unpackedInt32.length))
                        message.unpackedInt32 = [];
                    if ((tag & 7) === 2) {
                        let end2 = reader.uint32() + reader.pos;
                        while (reader.pos < end2)
                            message.unpackedInt32.push(reader.int32());
                    } else
                        message.unpackedInt32.push(reader.int32());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    /**
     * Decodes a Message message from the specified reader or buffer, length delimited.
     * @function decodeDelimited
     * @memberof Message
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @returns {Message} Message
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    Message.decodeDelimited = function decodeDelimited(reader) {
        if (!(reader instanceof $Reader))
            reader = new $Reader(reader);
        return this.decode(reader, reader.uint32());
    };

    /**
     * Verifies a Message message.
     * @function verify
     * @memberof Message
     * @static
     * @param {Object.<string,*>} message Plain object to verify
     * @returns {string|null} `null` if valid, otherwise the reason why it is not
     */
    Message.verify = function verify(message) {
        if (typeof message !== "object" || message === null)
            return "object expected";
        if (message.lMessage != null && message.hasOwnProperty("lMessage")) {
            let error = $root.Message.verify(message.lMessage);
            if (error)
                return "lMessage." + error;
        }
        if (message.singleInt32 != null && message.hasOwnProperty("singleInt32"))
            if (!$util.isInteger(message.singleInt32))
                return "singleInt32: integer expected";
        if (message.singleInt64 != null && message.hasOwnProperty("singleInt64"))
            if (!$util.isInteger(message.singleInt64) && !(message.singleInt64 && $util.isInteger(message.singleInt64.low) && $util.isInteger(message.singleInt64.high)))
                return "singleInt64: integer|Long expected";
        if (message.singleUint32 != null && message.hasOwnProperty("singleUint32"))
            if (!$util.isInteger(message.singleUint32))
                return "singleUint32: integer expected";
        if (message.singleUint64 != null && message.hasOwnProperty("singleUint64"))
            if (!$util.isInteger(message.singleUint64) && !(message.singleUint64 && $util.isInteger(message.singleUint64.low) && $util.isInteger(message.singleUint64.high)))
                return "singleUint64: integer|Long expected";
        if (message.singleSint32 != null && message.hasOwnProperty("singleSint32"))
            if (!$util.isInteger(message.singleSint32))
                return "singleSint32: integer expected";
        if (message.singleSint64 != null && message.hasOwnProperty("singleSint64"))
            if (!$util.isInteger(message.singleSint64) && !(message.singleSint64 && $util.isInteger(message.singleSint64.low) && $util.isInteger(message.singleSint64.high)))
                return "singleSint64: integer|Long expected";
        if (message.singleBool != null && message.hasOwnProperty("singleBool"))
            if (typeof message.singleBool !== "boolean")
                return "singleBool: boolean expected";
        if (message.singleEnum != null && message.hasOwnProperty("singleEnum"))
            switch (message.singleEnum) {
            default:
                return "singleEnum: enum value expected";
            case 0:
            case 1:
            case 2:
                break;
            }
        if (message.singleFixed64 != null && message.hasOwnProperty("singleFixed64"))
            if (!$util.isInteger(message.singleFixed64) && !(message.singleFixed64 && $util.isInteger(message.singleFixed64.low) && $util.isInteger(message.singleFixed64.high)))
                return "singleFixed64: integer|Long expected";
        if (message.singleSfixed64 != null && message.hasOwnProperty("singleSfixed64"))
            if (!$util.isInteger(message.singleSfixed64) && !(message.singleSfixed64 && $util.isInteger(message.singleSfixed64.low) && $util.isInteger(message.singleSfixed64.high)))
                return "singleSfixed64: integer|Long expected";
        if (message.singleDouble != null && message.hasOwnProperty("singleDouble"))
            if (typeof message.singleDouble !== "number")
                return "singleDouble: number expected";
        if (message.singleString != null && message.hasOwnProperty("singleString"))
            if (!$util.isString(message.singleString))
                return "singleString: string expected";
        if (message.singleBytes != null && message.hasOwnProperty("singleBytes"))
            if (!(message.singleBytes && typeof message.singleBytes.length === "number" || $util.isString(message.singleBytes)))
                return "singleBytes: buffer expected";
        if (message.singleFixed32 != null && message.hasOwnProperty("singleFixed32"))
            if (!$util.isInteger(message.singleFixed32))
                return "singleFixed32: integer expected";
        if (message.singleSfixed32 != null && message.hasOwnProperty("singleSfixed32"))
            if (!$util.isInteger(message.singleSfixed32))
                return "singleSfixed32: integer expected";
        if (message.singleFloat != null && message.hasOwnProperty("singleFloat"))
            if (typeof message.singleFloat !== "number")
                return "singleFloat: number expected";
        if (message.singleMessage != null && message.hasOwnProperty("singleMessage")) {
            let error = $root.Message.verify(message.singleMessage);
            if (error)
                return "singleMessage." + error;
        }
        if (message.repeatedInt32 != null && message.hasOwnProperty("repeatedInt32")) {
            if (!Array.isArray(message.repeatedInt32))
                return "repeatedInt32: array expected";
            for (let i = 0; i < message.repeatedInt32.length; ++i)
                if (!$util.isInteger(message.repeatedInt32[i]))
                    return "repeatedInt32: integer[] expected";
        }
        if (message.repeatedString != null && message.hasOwnProperty("repeatedString")) {
            if (!Array.isArray(message.repeatedString))
                return "repeatedString: array expected";
            for (let i = 0; i < message.repeatedString.length; ++i)
                if (!$util.isString(message.repeatedString[i]))
                    return "repeatedString: string[] expected";
        }
        if (message.repeatedBytes != null && message.hasOwnProperty("repeatedBytes")) {
            if (!Array.isArray(message.repeatedBytes))
                return "repeatedBytes: array expected";
            for (let i = 0; i < message.repeatedBytes.length; ++i)
                if (!(message.repeatedBytes[i] && typeof message.repeatedBytes[i].length === "number" || $util.isString(message.repeatedBytes[i])))
                    return "repeatedBytes: buffer[] expected";
        }
        if (message.repeatedMessage != null && message.hasOwnProperty("repeatedMessage")) {
            if (!Array.isArray(message.repeatedMessage))
                return "repeatedMessage: array expected";
            for (let i = 0; i < message.repeatedMessage.length; ++i) {
                let error = $root.Message.verify(message.repeatedMessage[i]);
                if (error)
                    return "repeatedMessage." + error;
            }
        }
        if (message.unpackedInt32 != null && message.hasOwnProperty("unpackedInt32")) {
            if (!Array.isArray(message.unpackedInt32))
                return "unpackedInt32: array expected";
            for (let i = 0; i < message.unpackedInt32.length; ++i)
                if (!$util.isInteger(message.unpackedInt32[i]))
                    return "unpackedInt32: integer[] expected";
        }
        return null;
    };

    /**
     * Creates a Message message from a plain object. Also converts values to their respective internal types.
     * @function fromObject
     * @memberof Message
     * @static
     * @param {Object.<string,*>} object Plain object
     * @returns {Message} Message
     */
    Message.fromObject = function fromObject(object) {
        if (object instanceof $root.Message)
            return object;
        let message = new $root.Message();
        if (object.lMessage != null) {
            if (typeof object.lMessage !== "object")
                throw TypeError(".Message.lMessage: object expected");
            message.lMessage = $root.Message.fromObject(object.lMessage);
        }
        if (object.singleInt32 != null)
            message.singleInt32 = object.singleInt32 | 0;
        if (object.singleInt64 != null)
            if ($util.Long)
                (message.singleInt64 = $util.Long.fromValue(object.singleInt64)).unsigned = false;
            else if (typeof object.singleInt64 === "string")
                message.singleInt64 = parseInt(object.singleInt64, 10);
            else if (typeof object.singleInt64 === "number")
                message.singleInt64 = object.singleInt64;
            else if (typeof object.singleInt64 === "object")
                message.singleInt64 = new $util.LongBits(object.singleInt64.low >>> 0, object.singleInt64.high >>> 0).toNumber();
        if (object.singleUint32 != null)
            message.singleUint32 = object.singleUint32 >>> 0;
        if (object.singleUint64 != null)
            if ($util.Long)
                (message.singleUint64 = $util.Long.fromValue(object.singleUint64)).unsigned = true;
            else if (typeof object.singleUint64 === "string")
                message.singleUint64 = parseInt(object.singleUint64, 10);
            else if (typeof object.singleUint64 === "number")
                message.singleUint64 = object.singleUint64;
            else if (typeof object.singleUint64 === "object")
                message.singleUint64 = new $util.LongBits(object.singleUint64.low >>> 0, object.singleUint64.high >>> 0).toNumber(true);
        if (object.singleSint32 != null)
            message.singleSint32 = object.singleSint32 | 0;
        if (object.singleSint64 != null)
            if ($util.Long)
                (message.singleSint64 = $util.Long.fromValue(object.singleSint64)).unsigned = false;
            else if (typeof object.singleSint64 === "string")
                message.singleSint64 = parseInt(object.singleSint64, 10);
            else if (typeof object.singleSint64 === "number")
                message.singleSint64 = object.singleSint64;
            else if (typeof object.singleSint64 === "object")
                message.singleSint64 = new $util.LongBits(object.singleSint64.low >>> 0, object.singleSint64.high >>> 0).toNumber();
        if (object.singleBool != null)
            message.singleBool = Boolean(object.singleBool);
        switch (object.singleEnum) {
        default:
            if (typeof object.singleEnum === "number") {
                message.singleEnum = object.singleEnum;
                break;
            }
            break;
        case "ENUM_UNSPECIFIED":
        case 0:
            message.singleEnum = 0;
            break;
        case "ENUM_ONE":
        case 1:
            message.singleEnum = 1;
            break;
        case "ENUM_TWO":
        case 2:
            message.singleEnum = 2;
            break;
        }
        if (object.singleFixed64 != null)
            if ($util.Long)
                (message.singleFixed64 = $util.Long.fromValue(object.singleFixed64)).unsigned = false;
            else if (typeof object.singleFixed64 === "string")
                message.singleFixed64 = parseInt(object.singleFixed64, 10);
            else if (typeof object.singleFixed64 === "number")
                message.singleFixed64 = object.singleFixed64;
            else if (typeof object.singleFixed64 === "object")
                message.singleFixed64 = new $util.LongBits(object.singleFixed64.low >>> 0, object.singleFixed64.high >>> 0).toNumber();
        if (object.singleSfixed64 != null)
            if ($util.Long)
                (message.singleSfixed64 = $util.Long.fromValue(object.singleSfixed64)).unsigned = false;
            else if (typeof object.singleSfixed64 === "string")
                message.singleSfixed64 = parseInt(object.singleSfixed64, 10);
            else if (typeof object.singleSfixed64 === "number")
                message.singleSfixed64 = object.singleSfixed64;
            else if (typeof object.singleSfixed64 === "object")
                message.singleSfixed64 = new $util.LongBits(object.singleSfixed64.low >>> 0, object.singleSfixed64.high >>> 0).toNumber();
        if (object.singleDouble != null)
            message.singleDouble = Number(object.singleDouble);
        if (object.singleString != null)
            message.singleString = String(object.singleString);
        if (object.singleBytes != null)
            if (typeof object.singleBytes === "string")
                $util.base64.decode(object.singleBytes, message.singleBytes = $util.newBuffer($util.base64.length(object.singleBytes)), 0);
            else if (object.singleBytes.length >= 0)
                message.singleBytes = object.singleBytes;
        if (object.singleFixed32 != null)
            message.singleFixed32 = object.singleFixed32 >>> 0;
        if (object.singleSfixed32 != null)
            message.singleSfixed32 = object.singleSfixed32 | 0;
        if (object.singleFloat != null)
            message.singleFloat = Number(object.singleFloat);
        if (object.singleMessage != null) {
            if (typeof object.singleMessage !== "object")
                throw TypeError(".Message.singleMessage: object expected");
            message.singleMessage = $root.Message.fromObject(object.singleMessage);
        }
        if (object.repeatedInt32) {
            if (!Array.isArray(object.repeatedInt32))
                throw TypeError(".Message.repeatedInt32: array expected");
            message.repeatedInt32 = [];
            for (let i = 0; i < object.repeatedInt32.length; ++i)
                message.repeatedInt32[i] = object.repeatedInt32[i] | 0;
        }
        if (object.repeatedString) {
            if (!Array.isArray(object.repeatedString))
                throw TypeError(".Message.repeatedString: array expected");
            message.repeatedString = [];
            for (let i = 0; i < object.repeatedString.length; ++i)
                message.repeatedString[i] = String(object.repeatedString[i]);
        }
        if (object.repeatedBytes) {
            if (!Array.isArray(object.repeatedBytes))
                throw TypeError(".Message.repeatedBytes: array expected");
            message.repeatedBytes = [];
            for (let i = 0; i < object.repeatedBytes.length; ++i)
                if (typeof object.repeatedBytes[i] === "string")
                    $util.base64.decode(object.repeatedBytes[i], message.repeatedBytes[i] = $util.newBuffer($util.base64.length(object.repeatedBytes[i])), 0);
                else if (object.repeatedBytes[i].length >= 0)
                    message.repeatedBytes[i] = object.repeatedBytes[i];
        }
        if (object.repeatedMessage) {
            if (!Array.isArray(object.repeatedMessage))
                throw TypeError(".Message.repeatedMessage: array expected");
            message.repeatedMessage = [];
            for (let i = 0; i < object.repeatedMessage.length; ++i) {
                if (typeof object.repeatedMessage[i] !== "object")
                    throw TypeError(".Message.repeatedMessage: object expected");
                message.repeatedMessage[i] = $root.Message.fromObject(object.repeatedMessage[i]);
            }
        }
        if (object.unpackedInt32) {
            if (!Array.isArray(object.unpackedInt32))
                throw TypeError(".Message.unpackedInt32: array expected");
            message.unpackedInt32 = [];
            for (let i = 0; i < object.unpackedInt32.length; ++i)
                message.unpackedInt32[i] = object.unpackedInt32[i] | 0;
        }
        return message;
    };

    /**
     * Creates a plain object from a Message message. Also converts values to other types if specified.
     * @function toObject
     * @memberof Message
     * @static
     * @param {Message} message Message
     * @param {$protobuf.IConversionOptions} [options] Conversion options
     * @returns {Object.<string,*>} Plain object
     */
    Message.toObject = function toObject(message, options) {
        if (!options)
            options = {};
        let object = {};
        if (options.arrays || options.defaults) {
            object.repeatedInt32 = [];
            object.repeatedString = [];
            object.repeatedBytes = [];
            object.repeatedMessage = [];
            object.unpackedInt32 = [];
        }
        if (options.defaults) {
            object.lMessage = null;
            object.singleInt32 = 0;
            if ($util.Long) {
                let long = new $util.Long(0, 0, false);
                object.singleInt64 = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
            } else
                object.singleInt64 = options.longs === String ? "0" : 0;
            object.singleUint32 = 0;
            if ($util.Long) {
                let long = new $util.Long(0, 0, true);
                object.singleUint64 = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
            } else
                object.singleUint64 = options.longs === String ? "0" : 0;
            object.singleSint32 = 0;
            if ($util.Long) {
                let long = new $util.Long(0, 0, false);
                object.singleSint64 = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
            } else
                object.singleSint64 = options.longs === String ? "0" : 0;
            object.singleBool = false;
            object.singleEnum = options.enums === String ? "ENUM_UNSPECIFIED" : 0;
            if ($util.Long) {
                let long = new $util.Long(0, 0, false);
                object.singleFixed64 = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
            } else
                object.singleFixed64 = options.longs === String ? "0" : 0;
            if ($util.Long) {
                let long = new $util.Long(0, 0, false);
                object.singleSfixed64 = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
            } else
                object.singleSfixed64 = options.longs === String ? "0" : 0;
            object.singleDouble = 0;
            object.singleString = "";
            if (options.bytes === String)
                object.singleBytes = "";
            else {
                object.singleBytes = [];
                if (options.bytes !== Array)
                    object.singleBytes = $util.newBuffer(object.singleBytes);
            }
            object.singleFixed32 = 0;
            object.singleSfixed32 = 0;
            object.singleFloat = 0;
            object.singleMessage = null;
        }
        if (message.lMessage != null && message.hasOwnProperty("lMessage"))
            object.lMessage = $root.Message.toObject(message.lMessage, options);
        if (message.singleInt32 != null && message.hasOwnProperty("singleInt32"))
            object.singleInt32 = message.singleInt32;
        if (message.singleInt64 != null && message.hasOwnProperty("singleInt64"))
            if (typeof message.singleInt64 === "number")
                object.singleInt64 = options.longs === String ? String(message.singleInt64) : message.singleInt64;
            else
                object.singleInt64 = options.longs === String ? $util.Long.prototype.toString.call(message.singleInt64) : options.longs === Number ? new $util.LongBits(message.singleInt64.low >>> 0, message.singleInt64.high >>> 0).toNumber() : message.singleInt64;
        if (message.singleUint32 != null && message.hasOwnProperty("singleUint32"))
            object.singleUint32 = message.singleUint32;
        if (message.singleUint64 != null && message.hasOwnProperty("singleUint64"))
            if (typeof message.singleUint64 === "number")
                object.singleUint64 = options.longs === String ? String(message.singleUint64) : message.singleUint64;
            else
                object.singleUint64 = options.longs === String ? $util.Long.prototype.toString.call(message.singleUint64) : options.longs === Number ? new $util.LongBits(message.singleUint64.low >>> 0, message.singleUint64.high >>> 0).toNumber(true) : message.singleUint64;
        if (message.singleSint32 != null && message.hasOwnProperty("singleSint32"))
            object.singleSint32 = message.singleSint32;
        if (message.singleSint64 != null && message.hasOwnProperty("singleSint64"))
            if (typeof message.singleSint64 === "number")
                object.singleSint64 = options.longs === String ? String(message.singleSint64) : message.singleSint64;
            else
                object.singleSint64 = options.longs === String ? $util.Long.prototype.toString.call(message.singleSint64) : options.longs === Number ? new $util.LongBits(message.singleSint64.low >>> 0, message.singleSint64.high >>> 0).toNumber() : message.singleSint64;
        if (message.singleBool != null && message.hasOwnProperty("singleBool"))
            object.singleBool = message.singleBool;
        if (message.singleEnum != null && message.hasOwnProperty("singleEnum"))
            object.singleEnum = options.enums === String ? $root.Enum[message.singleEnum] === undefined ? message.singleEnum : $root.Enum[message.singleEnum] : message.singleEnum;
        if (message.singleFixed64 != null && message.hasOwnProperty("singleFixed64"))
            if (typeof message.singleFixed64 === "number")
                object.singleFixed64 = options.longs === String ? String(message.singleFixed64) : message.singleFixed64;
            else
                object.singleFixed64 = options.longs === String ? $util.Long.prototype.toString.call(message.singleFixed64) : options.longs === Number ? new $util.LongBits(message.singleFixed64.low >>> 0, message.singleFixed64.high >>> 0).toNumber() : message.singleFixed64;
        if (message.singleSfixed64 != null && message.hasOwnProperty("singleSfixed64"))
            if (typeof message.singleSfixed64 === "number")
                object.singleSfixed64 = options.longs === String ? String(message.singleSfixed64) : message.singleSfixed64;
            else
                object.singleSfixed64 = options.longs === String ? $util.Long.prototype.toString.call(message.singleSfixed64) : options.longs === Number ? new $util.LongBits(message.singleSfixed64.low >>> 0, message.singleSfixed64.high >>> 0).toNumber() : message.singleSfixed64;
        if (message.singleDouble != null && message.hasOwnProperty("singleDouble"))
            object.singleDouble = options.json && !isFinite(message.singleDouble) ? String(message.singleDouble) : message.singleDouble;
        if (message.singleString != null && message.hasOwnProperty("singleString"))
            object.singleString = message.singleString;
        if (message.singleBytes != null && message.hasOwnProperty("singleBytes"))
            object.singleBytes = options.bytes === String ? $util.base64.encode(message.singleBytes, 0, message.singleBytes.length) : options.bytes === Array ? Array.prototype.slice.call(message.singleBytes) : message.singleBytes;
        if (message.singleFixed32 != null && message.hasOwnProperty("singleFixed32"))
            object.singleFixed32 = message.singleFixed32;
        if (message.singleSfixed32 != null && message.hasOwnProperty("singleSfixed32"))
            object.singleSfixed32 = message.singleSfixed32;
        if (message.singleFloat != null && message.hasOwnProperty("singleFloat"))
            object.singleFloat = options.json && !isFinite(message.singleFloat) ? String(message.singleFloat) : message.singleFloat;
        if (message.singleMessage != null && message.hasOwnProperty("singleMessage"))
            object.singleMessage = $root.Message.toObject(message.singleMessage, options);
        if (message.repeatedInt32 && message.repeatedInt32.length) {
            object.repeatedInt32 = [];
            for (let j = 0; j < message.repeatedInt32.length; ++j)
                object.repeatedInt32[j] = message.repeatedInt32[j];
        }
        if (message.repeatedString && message.repeatedString.length) {
            object.repeatedString = [];
            for (let j = 0; j < message.repeatedString.length; ++j)
                object.repeatedString[j] = message.repeatedString[j];
        }
        if (message.repeatedBytes && message.repeatedBytes.length) {
            object.repeatedBytes = [];
            for (let j = 0; j < message.repeatedBytes.length; ++j)
                object.repeatedBytes[j] = options.bytes === String ? $util.base64.encode(message.repeatedBytes[j], 0, message.repeatedBytes[j].length) : options.bytes === Array ? Array.prototype.slice.call(message.repeatedBytes[j]) : message.repeatedBytes[j];
        }
        if (message.repeatedMessage && message.repeatedMessage.length) {
            object.repeatedMessage = [];
            for (let j = 0; j < message.repeatedMessage.length; ++j)
                object.repeatedMessage[j] = $root.Message.toObject(message.repeatedMessage[j], options);
        }
        if (message.unpackedInt32 && message.unpackedInt32.length) {
            object.unpackedInt32 = [];
            for (let j = 0; j < message.unpackedInt32.length; ++j)
                object.unpackedInt32[j] = message.unpackedInt32[j];
        }
        return object;
    };

    /**
     * Converts this Message to JSON.
     * @function toJSON
     * @memberof Message
     * @instance
     * @returns {Object.<string,*>} JSON object
     */
    Message.prototype.toJSON = function toJSON() {
        return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
    };

    /**
     * Gets the default type url for Message
     * @function getTypeUrl
     * @memberof Message
     * @static
     * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
     * @returns {string} The default type url
     */
    Message.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
        if (typeUrlPrefix === undefined) {
            typeUrlPrefix = "type.googleapis.com";
        }
        return typeUrlPrefix + "/Message";
    };

    return Message;
})();

export { $root as default };
