import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  NotificationShowInput,
  type NotificationShowInputEncoded,
  NotificationShowResult,
} from "./herdr-models.ts";
import { decodeHerdrInput, decodeHerdrWire } from "./herdr-schema-boundary.ts";
import { defineHerdrOperation } from "./herdr-effect-operation.ts";
import {
  HerdrTransport,
  herdrTransportLayer,
  type HerdrTransportRequestError,
  type HerdrTransportRequestOptionsEncoded,
} from "./herdr-transport.ts";

const parseNotificationShowInput = Schema.decodeUnknownEffect(NotificationShowInput);
const parseNotificationShowResult = Schema.decodeUnknownEffect(NotificationShowResult);

/** Foreground notification capability. */
export interface INotificationService {
  /** Shows a notification through the active foreground Herdr client. */
  readonly show: (
    input: NotificationShowInputEncoded,
    options?: HerdrTransportRequestOptionsEncoded,
  ) => Effect.Effect<NotificationShowResult, HerdrTransportRequestError>;
}

/** Yieldable Effect service for foreground notifications. */
export class NotificationService extends Context.Service<
  NotificationService,
  INotificationService
>()("@herdr/sdk/NotificationService") {}

/** Constructs notification operations while preserving the shared transport requirement. */
export const makeNotificationService = Effect.gen(function* () {
  const transport = yield* HerdrTransport;
  return NotificationService.of({
    show: defineHerdrOperation("NotificationService.show", (input, options = {}) =>
      Effect.gen(function* () {
        const parsed = yield* decodeHerdrInput(
          "NotificationService.show",
          parseNotificationShowInput,
          input,
        );
        const parametersWithoutSound = {
          title: parsed.title,
          body: Option.getOrNull(parsed.body),
          position: Option.getOrNull(parsed.position),
        };
        const parameters = Option.match(parsed.sound, {
          onNone: () => parametersWithoutSound,
          onSome: (sound) => ({ ...parametersWithoutSound, sound }),
        });
        const response = yield* transport.request("notification.show", parameters, options);
        return yield* decodeHerdrWire(
          parseNotificationShowResult,
          response.result,
          response.requestId,
        );
      }),
    ),
  });
});

/** Provides notifications while retaining the shared transport requirement. */
export const notificationServiceLayerWithoutDependencies: Layer.Layer<
  NotificationService,
  never,
  HerdrTransport
> = Layer.effect(NotificationService, makeNotificationService);

/** Production notification-service Layer using the ambient Herdr transport graph. */
export const notificationServiceLayer = notificationServiceLayerWithoutDependencies.pipe(
  Layer.provide(herdrTransportLayer),
);
