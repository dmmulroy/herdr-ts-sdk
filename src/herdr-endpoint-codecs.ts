/**
 * Implements Herdr endpoint generation-1 bincode-standard envelopes and surface decoding.
 * Variant tags and field order follow v0.9.0 src/protocol/wire.rs; frames use a u32LE byte length.
 * @since 0.9.0
 */
import { Buffer } from "node:buffer";
import { Result } from "effect";
import { HerdrEndpointInvalidMessage } from "./herdr-endpoint-errors.ts";
import type {
  ClientShellHostColor,
  ClientShellHostThemeInput,
  ClientShellKeyInput,
  ClientShellMouseInput,
} from "./herdr-client-shell-input.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

class EndpointReader {
  private offset = 0;
  constructor(private readonly bytes: Buffer) {}
  private take(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.length - this.offset)
      throw new HerdrEndpointInvalidMessage("framing");
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  byte(): number {
    return this.take(1).readUInt8();
  }
  bool(): boolean {
    const value = this.byte();
    if (value > 1) throw new HerdrEndpointInvalidMessage("framing");
    return value === 1;
  }
  uint64(maximumTag = 253): bigint {
    const tag = this.byte();
    if (tag > maximumTag) throw new HerdrEndpointInvalidMessage("framing");
    if (tag <= 250) return BigInt(tag);
    if (tag === 251) return BigInt(this.take(2).readUInt16LE());
    if (tag === 252) return BigInt(this.take(4).readUInt32LE());
    if (tag === 253) return this.take(8).readBigUInt64LE();
    throw new HerdrEndpointInvalidMessage("framing");
  }
  uint(maximum = Number.MAX_SAFE_INTEGER): number {
    const value = this.uint64();
    if (value > BigInt(maximum)) throw new HerdrEndpointInvalidMessage("framing");
    return Number(value);
  }
  u16(): number {
    const value = this.uint64(251);
    if (value > 65535n) throw new HerdrEndpointInvalidMessage("framing");
    return Number(value);
  }
  u32(): number {
    const value = this.uint64(252);
    if (value > 0xffff_ffffn) throw new HerdrEndpointInvalidMessage("framing");
    return Number(value);
  }
  i32(): number {
    const value = this.u32();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }
  data(): Uint8Array {
    return new Uint8Array(this.take(this.uint(MAX_FRAME_BYTES)));
  }
  text(): string {
    return utf8.decode(this.data());
  }
  optional<A>(read: () => A): A | null {
    return this.bool() ? read() : null;
  }
  array<A>(read: () => A): A[] {
    const count = this.uint(Math.min(1_000_000, this.bytes.length - this.offset));
    const values: A[] = [];
    for (let index = 0; index < count; index++) values.push(read());
    return values;
  }
  choice<const A extends readonly string[]>(values: A): A[number] {
    const value = values[this.u32()];
    if (value === undefined) throw new HerdrEndpointInvalidMessage("framing");
    return value;
  }
  finish(): void {
    if (this.offset !== this.bytes.length) throw new HerdrEndpointInvalidMessage("framing");
  }
}

function readRect(reader: EndpointReader) {
  return { x: reader.u16(), y: reader.u16(), width: reader.u16(), height: reader.u16() };
}
function readCursor(reader: EndpointReader) {
  return { x: reader.u16(), y: reader.u16(), visible: reader.bool(), shape: reader.byte() };
}
function readCell(reader: EndpointReader) {
  return {
    symbol: reader.text(),
    fg: reader.u32(),
    bg: reader.u32(),
    modifier: reader.u16(),
    skip: reader.bool(),
    hyperlink: reader.optional(() => reader.u32()),
  };
}
function readFrame(reader: EndpointReader) {
  return {
    cells: reader.array(() => readCell(reader)),
    width: reader.u16(),
    height: reader.u16(),
    cursor: reader.optional(() => readCursor(reader)),
    hyperlinks: reader.array(() => reader.text()),
    graphics: reader.data(),
  };
}
function readSurfacePane(reader: EndpointReader) {
  return {
    paneId: reader.text(),
    contentRevision: reader.uint(),
    rect: readRect(reader),
    innerRect: readRect(reader),
    scrollbarRect: reader.optional(() => readRect(reader)),
    scroll: reader.optional(() => ({
      offsetFromBottom: reader.uint(),
      maxOffsetFromBottom: reader.uint(),
      viewportRows: reader.uint(),
    })),
    focused: reader.bool(),
    mouseReporting: reader.bool(),
    sgrPixelMouse: reader.bool(),
    alternateScreenActive: reader.bool(),
    pixelWidth: reader.u32(),
    pixelHeight: reader.u32(),
  };
}
function readGraphicsTarget(reader: EndpointReader) {
  const kind = reader.choice(["pane", "popup"]);
  return kind === "pane" ? { kind, paneId: reader.text() } : { kind, terminalId: reader.text() };
}
function readGraphicsSource(reader: EndpointReader) {
  const kind = reader.choice(["terminal", "paneLayer"]);
  return kind === "terminal"
    ? { kind, target: readGraphicsTarget(reader), imageId: reader.u32() }
    : { kind, paneId: reader.text(), layerId: reader.text() };
}
function readGraphicsKey(reader: EndpointReader) {
  return {
    source: readGraphicsSource(reader),
    imageWidth: reader.u32(),
    imageHeight: reader.u32(),
    format: reader.choice(["rgb", "rgba", "png"]),
    dataLength: reader.uint(),
    dataFingerprint: reader.uint64(),
  };
}
function readGraphicsScene(reader: EndpointReader) {
  return {
    assets: reader.array(() => ({ key: readGraphicsKey(reader), data: reader.data() })),
    placements: reader.array(() => ({
      asset: readGraphicsKey(reader),
      logicalPlacementId: reader.u32(),
      x: reader.u16(),
      y: reader.u16(),
      cols: reader.u32(),
      rows: reader.u32(),
      sourceX: reader.u32(),
      sourceY: reader.u32(),
      sourceWidth: reader.u32(),
      sourceHeight: reader.u32(),
      xOffset: reader.u32(),
      yOffset: reader.u32(),
      z: reader.i32(),
      scrollbackOffset: reader.u32(),
    })),
    retainedAssets: reader.array(() => readGraphicsKey(reader)),
  };
}
function readPopupSize(reader: EndpointReader) {
  const kind = reader.choice(["cells", "percent"]);
  return { kind, value: kind === "cells" ? reader.u16() : reader.byte() };
}
function readPopup(reader: EndpointReader) {
  return {
    terminalId: reader.text(),
    title: reader.text(),
    width: reader.optional(() => readPopupSize(reader)),
    height: reader.optional(() => readPopupSize(reader)),
    frame: readFrame(reader),
    mouseReporting: reader.bool(),
    sgrPixelMouse: reader.bool(),
    pixelWidth: reader.u32(),
    pixelHeight: reader.u32(),
  };
}
function readSurface(reader: EndpointReader) {
  return {
    bootId: reader.text(),
    projectionRevision: reader.uint(),
    surfaceRevision: reader.uint(),
    frame: readFrame(reader),
    panes: reader.array(() => readSurfacePane(reader)),
    splits: reader.array(() => ({
      direction: reader.choice(["horizontal", "vertical"]),
      pos: reader.u16(),
      area: readRect(reader),
      hitRect: readRect(reader),
      path: reader.array(() => reader.bool()),
    })),
    popup: reader.optional(() => readPopup(reader)),
    graphics: readGraphicsScene(reader),
  };
}
function readPatch(reader: EndpointReader) {
  return {
    bootId: reader.text(),
    projectionRevision: reader.uint(),
    baseSurfaceRevision: reader.uint(),
    surfaceRevision: reader.uint(),
    rows: reader.array(() => ({
      x: reader.u16(),
      y: reader.u16(),
      cells: reader.array(() => readCell(reader)),
    })),
    panes: reader.array(() => readSurfacePane(reader)),
    cursor: reader.optional(() => readCursor(reader)),
  };
}
function readServerMessage(reader: EndpointReader) {
  const tag = reader.u32();
  switch (tag) {
    case 2:
      return { kind: "graphics" as const, bytes: reader.data() };
    case 3:
      return { kind: "shutdown" as const, reason: reader.optional(() => reader.text()) };
    case 4:
      return {
        kind: "notify" as const,
        delivery: reader.choice(["sound", "toast", "systemToast"]),
        message: reader.text(),
        body: reader.optional(() => reader.text()),
      };
    case 5:
      return { kind: "clipboard" as const, data: reader.text() };
    case 6:
      return { kind: "windowTitle" as const, title: reader.optional(() => reader.text()) };
    case 7:
      return { kind: "reloadSoundConfig" as const };
    case 8:
      return { kind: "mouseCapture" as const, enabled: reader.bool(), sgrPixels: reader.bool() };
    case 9:
      return { kind: "terminalBell" as const, count: reader.u16() };
    case 10:
      return {
        kind: "graphicsFile" as const,
        path: reader.text(),
        expectedLength: reader.uint(),
        imageId: reader.u32(),
        transferId: reader.uint(),
        leading: reader.data(),
        control: reader.text(),
        surfaceAsset: reader.optional(() => readGraphicsKey(reader)),
      };
    case 11:
      return { kind: "graphicsRetired" as const, transferId: reader.uint(), imageId: reader.u32() };
    case 13:
      return { kind: "surface" as const, surface: readSurface(reader) };
    case 14:
      return {
        kind: "notification" as const,
        notification: {
          kind: reader.choice(["needsAttention", "finished", "updateInstalled", "custom"]),
          title: reader.text(),
          body: reader.optional(() => reader.text()),
          sound: reader.optional(() => reader.choice(["done", "request"])),
          agent: reader.optional(() => reader.text()),
          workspaceId: reader.optional(() => reader.text()),
          tabId: reader.optional(() => reader.text()),
          paneId: reader.optional(() => reader.text()),
          position: reader.optional(() =>
            reader.choice(["topLeft", "topRight", "bottomLeft", "bottomRight"]),
          ),
        },
      };
    case 15:
      return { kind: "error" as const, message: reader.text() };
    case 16:
      return {
        kind: "keyboardProtocol" as const,
        flags: reader.u16(),
        modifyOtherKeysLevel: reader.byte(),
      };
    case 17:
      return { kind: "keyboardReportAll" as const, enabled: reader.bool() };
    case 18:
      return {
        kind: "response" as const,
        bootId: reader.text(),
        requestId: reader.text(),
        finalChunk: reader.bool(),
        data: reader.data(),
      };
    case 19:
      return { kind: "patch" as const, patch: readPatch(reader) };
    case 20:
      return { kind: "control" as const, name: reader.text(), data: reader.text() };
    default:
      throw new HerdrEndpointInvalidMessage("unsupported_message");
  }
}

/** Validated bincode envelope; domain schemas validate its nested presentation data next. @category models @since 0.9.0 */
export type EndpointServerMessage = ReturnType<typeof readServerMessage>;
/** Decodes one complete bincode payload, rejecting trailing bytes and unsafe integer conversions. @category decoding @since 0.9.0 */
export function decodeEndpointMessage(
  payload: Uint8Array,
): Result.Result<EndpointServerMessage, HerdrEndpointInvalidMessage> {
  return Result.try({
    try: () => {
      const reader = new EndpointReader(Buffer.from(payload));
      const message = readServerMessage(reader);
      reader.finish();
      return message;
    },
    catch: (cause) =>
      cause instanceof HerdrEndpointInvalidMessage
        ? cause
        : new HerdrEndpointInvalidMessage("framing"),
  });
}

function encodeUnsigned(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new HerdrEndpointInvalidMessage("framing");
  if (value <= 250) return Buffer.from([value]);
  if (value <= 65535) {
    const bytes = Buffer.alloc(3);
    bytes[0] = 251;
    bytes.writeUInt16LE(value, 1);
    return bytes;
  }
  if (value <= 0xffff_ffff) {
    const bytes = Buffer.alloc(5);
    bytes[0] = 252;
    bytes.writeUInt32LE(value, 1);
    return bytes;
  }
  const bytes = Buffer.alloc(9);
  bytes[0] = 253;
  bytes.writeBigUInt64LE(BigInt(value), 1);
  return bytes;
}
function encodeText(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  return Buffer.concat([encodeUnsigned(bytes.length), bytes]);
}
function frameEndpointPayload(parts: readonly Uint8Array[]): Uint8Array {
  const payload = Buffer.concat(parts);
  if (payload.length > MAX_FRAME_BYTES) throw new HerdrEndpointInvalidMessage("oversized_frame");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}
/** Encodes a named generation-1 client control as a complete framed message. @category encoding @since 0.9.0 */
export function encodeEndpointControl(kind: string, data: string): Uint8Array {
  return frameEndpointPayload([encodeUnsigned(20), encodeText(kind), encodeText(data)]);
}
/** Encodes one request bound to the endpoint process that issued its projection. @category encoding @since 0.9.0 */
export function encodeEndpointRequest(bootId: string, request: string): Uint8Array {
  return frameEndpointPayload([encodeUnsigned(15), encodeText(bootId), encodeText(request)]);
}
/** Encodes one semantic paste/text commit for a stable pane or popup target. @category encoding @since 0.9.0 */
export function encodeEndpointText(
  target: "pane" | "popup",
  id: string,
  text: string,
  mode: "paste" | "text",
): Uint8Array {
  return frameEndpointPayload([
    encodeUnsigned(target === "pane" ? 13 : 14),
    encodeText(id),
    encodeUnsigned(1),
    encodeUnsigned(mode === "paste" ? 3 : 1),
    encodeText(text),
  ]);
}
const endpointNamedKeys = {
  backspace: 0,
  enter: 1,
  left: 2,
  right: 3,
  up: 4,
  down: 5,
  home: 6,
  end: 7,
  pageUp: 8,
  pageDown: 9,
  tab: 10,
  backTab: 11,
  delete: 12,
  insert: 13,
  escape: 14,
  null: 17,
} as const;
function encodeOptional<A>(value: A | undefined, encode: (value: A) => Uint8Array): Uint8Array {
  return value === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), encode(value)]);
}
/** Encodes a parsed semantic key lifecycle event, including optional Windows identity. @category encoding @since 0.9.0 */
export function encodeEndpointKey(
  target: "pane" | "popup",
  id: string,
  input: ClientShellKeyInput,
): Uint8Array {
  const key =
    input.code.kind === "named"
      ? encodeUnsigned(endpointNamedKeys[input.code.name])
      : input.code.kind === "function"
        ? Buffer.from([16, input.code.number])
        : Buffer.concat([Buffer.from([15]), Buffer.from(input.code.character, "utf8")]);
  return frameEndpointPayload([
    encodeUnsigned(target === "pane" ? 13 : 14),
    encodeText(id),
    encodeUnsigned(1),
    encodeUnsigned(0),
    key,
    Buffer.from([input.modifiers ?? 0]),
    encodeUnsigned(input.phase === "repeat" ? 1 : input.phase === "release" ? 2 : 0),
    encodeUnsigned(input.repeatCount ?? 1),
    encodeOptional(input.shiftedCodepoint, encodeUnsigned),
    encodeOptional(input.generatedText, encodeText),
    Buffer.from([input.tracksRelease ? 1 : 0]),
    encodeOptional(input.physicalKeyId, encodeUnsigned),
    encodeOptional(input.windowsRecord, (record) =>
      Buffer.concat([
        Buffer.from([record.keyDown ? 1 : 0]),
        encodeUnsigned(record.repeatCount),
        encodeUnsigned(record.virtualKeyCode),
        encodeUnsigned(record.virtualScanCode),
        encodeUnsigned(record.unicode),
        encodeUnsigned(record.controlKeyState),
      ]),
    ),
  ]);
}
/** Encodes a parsed cell/pixel mouse event for an explicit pane or popup target. @category encoding @since 0.9.0 */
export function encodeEndpointMouse(
  target: "pane" | "popup",
  id: string,
  input: ClientShellMouseInput,
): Uint8Array {
  const actions = {
    down: 0,
    up: 1,
    drag: 2,
    move: 3,
    scrollUp: 4,
    scrollDown: 5,
    scrollLeft: 6,
    scrollRight: 7,
  } as const;
  const buttons = { left: 0, right: 1, middle: 2 } as const;
  const position = input.position;
  return frameEndpointPayload([
    encodeUnsigned(target === "pane" ? 13 : 14),
    encodeText(id),
    encodeUnsigned(1),
    encodeUnsigned(2),
    encodeUnsigned(actions[input.gesture.action]),
    ...("button" in input.gesture ? [encodeUnsigned(buttons[input.gesture.button])] : []),
    encodeUnsigned(position.units === "cells" ? 0 : 1),
    ...(position.units === "pixels"
      ? [encodeUnsigned(position.x), encodeUnsigned(position.y)]
      : []),
    encodeUnsigned(position.column),
    encodeUnsigned(position.row),
    encodeOptional(input.geometry, (geometry) =>
      Buffer.concat([
        encodeUnsigned(geometry.columns),
        encodeUnsigned(geometry.rows),
        encodeUnsigned(geometry.widthPixels),
        encodeUnsigned(geometry.heightPixels),
      ]),
    ),
    Buffer.from([input.modifiers ?? 0]),
    encodeUnsigned(input.lines ?? 1),
  ]);
}
/** Encodes the surface dimensions used by the client shell, not the entire host terminal. @category encoding @since 0.9.0 */
export function encodeEndpointResize(
  columns: number,
  rows: number,
  cellWidth: number,
  cellHeight: number,
  pixelMouse: boolean,
): Uint8Array {
  return frameEndpointPayload([
    encodeUnsigned(12),
    encodeUnsigned(cellWidth),
    encodeUnsigned(cellHeight),
    encodeUnsigned(columns),
    encodeUnsigned(rows),
    Buffer.from([pixelMouse ? 1 : 0]),
  ]);
}
/** Encodes client-local focus or mouse-capture preference, never a global focus command. @category encoding @since 0.9.0 */
export function encodeEndpointPreference(
  preference: "focus" | "mouseCapture",
  enabled: boolean,
): Uint8Array {
  return frameEndpointPayload([
    encodeUnsigned(preference === "focus" ? 18 : 19),
    Buffer.from([enabled ? 1 : 0]),
  ]);
}
// bincode writes u8 fields as one raw byte; only enum variants and Vec lengths are varints.
function encodeHostColor(color: ClientShellHostColor): Buffer {
  return Buffer.from([color.r, color.g, color.b]);
}
/**
 * Encodes a parsed host terminal theme update (`ClientShellHostTheme`, client message tag 17).
 * @category encoding @since 0.9.5
 */
export function encodeEndpointHostTheme(input: ClientShellHostThemeInput): Uint8Array {
  const update =
    input.kind === "defaultColor"
      ? [
          encodeUnsigned(0),
          encodeUnsigned(input.target === "foreground" ? 0 : 1),
          encodeHostColor(input.color),
        ]
      : input.kind === "palette"
        ? [
            encodeUnsigned(1),
            encodeUnsigned(input.colors.length),
            ...input.colors.flatMap((entry) => [
              Buffer.from([entry.index]),
              encodeHostColor(entry.color),
            ]),
          ]
        : [encodeUnsigned(2), encodeUnsigned(input.appearance === "dark" ? 0 : 1)];
  return frameEndpointPayload([encodeUnsigned(17), ...update]);
}
