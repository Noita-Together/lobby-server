import * as $protobuf from "protobufjs";
import Long = require("long");
/** Enum enum. */
export enum Enum {
    ENUM_UNSPECIFIED = 0,
    ENUM_ONE = 1,
    ENUM_TWO = 2
}

/** Represents a Message. */
export class Message implements IMessage {

    /**
     * Constructs a new Message.
     * @param [properties] Properties to set
     */
    constructor(properties?: IMessage);

    /** Message lMessage. */
    public lMessage?: (IMessage|null);

    /** Message singleInt32. */
    public singleInt32: number;

    /** Message singleInt64. */
    public singleInt64: (number|Long);

    /** Message singleUint32. */
    public singleUint32: number;

    /** Message singleUint64. */
    public singleUint64: (number|Long);

    /** Message singleSint32. */
    public singleSint32: number;

    /** Message singleSint64. */
    public singleSint64: (number|Long);

    /** Message singleBool. */
    public singleBool: boolean;

    /** Message singleEnum. */
    public singleEnum: Enum;

    /** Message singleFixed64. */
    public singleFixed64: (number|Long);

    /** Message singleSfixed64. */
    public singleSfixed64: (number|Long);

    /** Message singleDouble. */
    public singleDouble: number;

    /** Message singleString. */
    public singleString: string;

    /** Message singleBytes. */
    public singleBytes: Uint8Array;

    /** Message singleFixed32. */
    public singleFixed32: number;

    /** Message singleSfixed32. */
    public singleSfixed32: number;

    /** Message singleFloat. */
    public singleFloat: number;

    /** Message singleMessage. */
    public singleMessage?: (IMessage|null);

    /** Message repeatedInt32. */
    public repeatedInt32: number[];

    /** Message repeatedString. */
    public repeatedString: string[];

    /** Message repeatedBytes. */
    public repeatedBytes: Uint8Array[];

    /** Message repeatedMessage. */
    public repeatedMessage: IMessage[];

    /** Message unpackedInt32. */
    public unpackedInt32: number[];

    /**
     * Creates a new Message instance using the specified properties.
     * @param [properties] Properties to set
     * @returns Message instance
     */
    public static create(properties?: IMessage): Message;

    /**
     * Encodes the specified Message message. Does not implicitly {@link Message.verify|verify} messages.
     * @param message Message message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: IMessage, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Encodes the specified Message message, length delimited. Does not implicitly {@link Message.verify|verify} messages.
     * @param message Message message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encodeDelimited(message: IMessage, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a Message message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns Message
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): Message;

    /**
     * Decodes a Message message from the specified reader or buffer, length delimited.
     * @param reader Reader or buffer to decode from
     * @returns Message
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): Message;

    /**
     * Verifies a Message message.
     * @param message Plain object to verify
     * @returns `null` if valid, otherwise the reason why it is not
     */
    public static verify(message: { [k: string]: any }): (string|null);

    /**
     * Creates a Message message from a plain object. Also converts values to their respective internal types.
     * @param object Plain object
     * @returns Message
     */
    public static fromObject(object: { [k: string]: any }): Message;

    /**
     * Creates a plain object from a Message message. Also converts values to other types if specified.
     * @param message Message
     * @param [options] Conversion options
     * @returns Plain object
     */
    public static toObject(message: Message, options?: $protobuf.IConversionOptions): { [k: string]: any };

    /**
     * Converts this Message to JSON.
     * @returns JSON object
     */
    public toJSON(): { [k: string]: any };

    /**
     * Gets the default type url for Message
     * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
     * @returns The default type url
     */
    public static getTypeUrl(typeUrlPrefix?: string): string;
}
