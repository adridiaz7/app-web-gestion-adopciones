// Types shared by the server and the client. Types only: the browser cannot load npm packages.

export interface HealthResponse {
  status: "ok";
}

export interface ErrorResponse {
  error: string;
}
