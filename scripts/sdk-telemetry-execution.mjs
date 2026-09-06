import { Schema } from "effect";

const numericMetadataKeys = new Set([
  "sdk.attempt",
  "sdk.stress.seed",
  "sdk.stress.repetitions",
  "sdk.execution_index",
  "sdk.telemetry.dropped",
  "sdk.telemetry.metadata_dropped",
  "sdk.exit_code",
  "herdr.deadline_ms",
  "herdr.bytes_written",
  "herdr.bytes_read",
  "herdr.events.count",
  "herdr.bytes.count",
]);
const tokenMetadataKeys = new Set([
  "herdr.method",
  "herdr.operation",
  "herdr.result_type",
  "herdr.error_tag",
  "herdr.reason",
  "sdk.stage.name",
  "sdk.stage.status",
  "sdk.command.name",
]);
const identityMetadataKeys = new Set(["sdk.run_id", "sdk.test_id", "herdr.connection_id"]);
const outcomeMetadataKeys = new Set(["sdk.outcome", "herdr.outcome"]);
/** Finite keys inspected at telemetry callback boundaries; never enumerate arbitrary metadata bags. */
export const sdkTelemetryAttributeKeys = [
  ...numericMetadataKeys,
  ...tokenMetadataKeys,
  ...identityMetadataKeys,
  ...outcomeMetadataKeys,
  "sdk.execution.kind",
  "status.interrupted",
];
const sdkMetadataText = Schema.String;
const isSdkMetadataText = Schema.is(sdkMetadataText);

/** Shared finite/value-constrained metadata policy for OTLP export and untrusted viewer response projections.
 * @param {string} key @param {string} value @param {Set<string>} tokens @returns {boolean}
 */
export const approvedSdkTelemetryAttribute = (key, value, tokens) => {
  if (!isSdkMetadataText(value)) return false;
  if (key === "sdk.stress.seed")
    return (
      /^-?(?:0|[1-9]\d{0,9})$/.test(value) &&
      Number(value) >= -2147483648 &&
      Number(value) <= 2147483647
    );
  if (key === "sdk.stress.repetitions")
    return /^[1-9]\d{0,3}$/.test(value) && Number(value) <= 1000;
  if (numericMetadataKeys.has(key))
    return /^\d{1,10}$/.test(value) && Number(value) <= 1_000_000_000;
  if (identityMetadataKeys.has(key))
    return /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
      value,
    );
  if (outcomeMetadataKeys.has(key)) return ["success", "failure", "interrupted"].includes(value);
  if (key === "sdk.execution.kind")
    return ["test", "verification", "lab", "application"].includes(value);
  if (key === "status.interrupted") return value === "true";
  return tokenMetadataKeys.has(key) && tokens.has(value);
};
