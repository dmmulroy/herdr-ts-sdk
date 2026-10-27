/**
 * Models semantic pane input independently from host-terminal escape sequences.
 * Domain discriminators are used only for composable key/mouse values; no public input requires _tag.
 * @since 0.9.0
 */
import { Schema } from "effect";

const U8 = Schema.Natural.check(Schema.isLessThanOrEqualTo(255));
const U16 = Schema.Natural.check(Schema.isLessThanOrEqualTo(65535));
const U32 = Schema.Natural.check(Schema.isLessThanOrEqualTo(0xffff_ffff));
/** A named key, Unicode scalar, or function key for semantic endpoint input. @category schemas @since 0.9.0 */
export const ClientShellKeyCode = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("named"),
    name: Schema.Literals([
      "backspace",
      "enter",
      "left",
      "right",
      "up",
      "down",
      "home",
      "end",
      "pageUp",
      "pageDown",
      "tab",
      "backTab",
      "delete",
      "insert",
      "escape",
      "null",
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("character"),
    character: Schema.String.check(
      Schema.makeFilter(
        (text) =>
          (Array.from(text).length === 1 && !/^[\uD800-\uDFFF]$/.test(text)) ||
          "Endpoint key must be one Unicode scalar",
      ),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal("function"), number: U8 }),
]);
/** Parsed semantic key code. @category models @since 0.9.0 */
export type ClientShellKeyCode = typeof ClientShellKeyCode.Type;
/** Windows console key identity, when input originates from a native record. @category schemas @since 0.9.0 */
export const ClientShellWindowsKeyRecord = Schema.Struct({
  keyDown: Schema.Boolean,
  repeatCount: U16,
  virtualKeyCode: U16,
  virtualScanCode: U16,
  unicode: U16,
  controlKeyState: U32,
});
/** Semantic key lifecycle and optional native identity. @category schemas @since 0.9.0 */
export const ClientShellKeyInput = Schema.Struct({
  code: ClientShellKeyCode,
  modifiers: Schema.optionalKey(U8),
  phase: Schema.optionalKey(Schema.Literals(["press", "repeat", "release"])),
  repeatCount: Schema.optionalKey(U16),
  shiftedCodepoint: Schema.optionalKey(U32),
  generatedText: Schema.optionalKey(Schema.String),
  tracksRelease: Schema.optionalKey(Schema.Boolean),
  physicalKeyId: Schema.optionalKey(U32),
  windowsRecord: Schema.optionalKey(ClientShellWindowsKeyRecord),
});
/** Parsed semantic key event. @category models @since 0.9.0 */
export type ClientShellKeyInput = typeof ClientShellKeyInput.Type;
/** Caller-supplied semantic key event. @category inputs @since 0.9.0 */
export type ClientShellKeyInputEncoded = typeof ClientShellKeyInput.Encoded;
/** Mouse action, optionally identifying a button. @category schemas @since 0.9.0 */
export const ClientShellMouseAction = Schema.Union([
  Schema.Struct({
    action: Schema.Literals(["down", "up", "drag"]),
    button: Schema.Literals(["left", "right", "middle"]),
  }),
  Schema.Struct({
    action: Schema.Literals(["move", "scrollUp", "scrollDown", "scrollLeft", "scrollRight"]),
  }),
]);
/** Mouse coordinates distinguish terminal cells from exact pixels. @category schemas @since 0.9.0 */
export const ClientShellMousePosition = Schema.Union([
  Schema.Struct({ units: Schema.Literal("cells"), column: U16, row: U16 }),
  Schema.Struct({ units: Schema.Literal("pixels"), x: U32, y: U32, column: U16, row: U16 }),
]);
/** Semantic mouse input with optional coherent target geometry. @category schemas @since 0.9.0 */
export const ClientShellMouseInput = Schema.Struct({
  gesture: ClientShellMouseAction,
  position: ClientShellMousePosition,
  geometry: Schema.optionalKey(
    Schema.Struct({ columns: U16, rows: U16, widthPixels: U32, heightPixels: U32 }),
  ),
  modifiers: Schema.optionalKey(U8),
  lines: Schema.optionalKey(U16),
});
/** Parsed semantic mouse event. @category models @since 0.9.0 */
export type ClientShellMouseInput = typeof ClientShellMouseInput.Type;
/** Caller-supplied semantic mouse event. @category inputs @since 0.9.0 */
export type ClientShellMouseInputEncoded = typeof ClientShellMouseInput.Encoded;
/** One host terminal RGB color; each channel is an 8-bit integer from 0 to 255. @category schemas @since 0.9.5 */
export const ClientShellHostColor = Schema.Struct({ r: U8, g: U8, b: U8 });
/** Parsed host terminal RGB color. @category models @since 0.9.5 */
export type ClientShellHostColor = typeof ClientShellHostColor.Type;
/** Caller-supplied host terminal RGB color. @category inputs @since 0.9.5 */
export type ClientShellHostColorEncoded = typeof ClientShellHostColor.Encoded;
/**
 * Maximum palette entries in one host theme update, matching Herdr's client-side batching bound.
 * @category constants @since 0.9.5
 */
export const CLIENT_SHELL_HOST_PALETTE_MAX_ENTRIES = 256;
/**
 * One outer (host) terminal theme update forwarded so pane applications pick matching colors:
 * a default foreground/background color, 1–256 indexed palette colors, or the light/dark appearance.
 * A background color also infers appearance on the server unless one was set explicitly.
 * @category schemas @since 0.9.5
 */
export const ClientShellHostThemeInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("defaultColor"),
    target: Schema.Literals(["foreground", "background"]),
    color: ClientShellHostColor,
  }),
  Schema.Struct({
    kind: Schema.Literal("palette"),
    colors: Schema.Array(Schema.Struct({ index: U8, color: ClientShellHostColor })).check(
      Schema.isLengthBetween(1, CLIENT_SHELL_HOST_PALETTE_MAX_ENTRIES),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("appearance"),
    appearance: Schema.Literals(["dark", "light"]),
  }),
]);
/** Parsed host terminal theme update. @category models @since 0.9.5 */
export type ClientShellHostThemeInput = typeof ClientShellHostThemeInput.Type;
/** Caller-supplied host terminal theme update. @category inputs @since 0.9.5 */
export type ClientShellHostThemeInputEncoded = typeof ClientShellHostThemeInput.Encoded;
