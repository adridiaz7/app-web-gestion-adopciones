// Types shared by the server and the client. Types only: the browser cannot load npm packages.

export interface HealthResponse {
  status: "ok";
}

export interface ErrorResponse {
  /** Message for the user, in Spanish. */
  error: string;
  /** Invalid input fields and their messages, when the input format is wrong. */
  fields?: Record<string, string>;
}
