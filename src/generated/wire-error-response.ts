/** Generated from schema/herdr-api.schema.json; do not edit. */

export interface ErrorResponse {
  error: ErrorBody;
  id: string;
  [k: string]: unknown;
}
export interface ErrorBody {
  code: string;
  message: string;
  [k: string]: unknown;
}
