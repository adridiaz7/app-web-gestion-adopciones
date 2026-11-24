// Types shared by the server and the client. Types only: the browser cannot load npm packages.

export interface HealthResponse {
  status: "ok";
}

/** Answer of an action that only reports what happened, with a message for the user. */
export interface MessageResponse {
  message: string;
}

/** CU-01 · POST /api/auth/register/adopter */
export interface AdopterRegistrationRequest {
  email: string;
  /** RN-175: 12 to 256 characters. */
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** YYYY-MM-DD. RN-25: must be an adult. */
  birthDate: string;
  provinceId: number;
  locality: string;
  /** RN-186: must be true. */
  acceptTerms: boolean;
}

export interface ErrorResponse {
  /** Message for the user, in Spanish. */
  error: string;
  /** Invalid input fields and their messages, when the input format is wrong. */
  fields?: Record<string, string>;
}
