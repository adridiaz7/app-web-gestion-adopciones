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

/** CU-02 · POST /api/auth/register/shelter */
export interface ShelterRegistrationRequest {
  email: string;
  /** RN-175: 12 to 256 characters. */
  password: string;
  name: string;
  /** RN-17: unique. Spaces and hyphens are ignored. */
  cif: string;
  address: string;
  provinceId: number;
  locality: string;
  phone: string;
  /** RN-186: must be true. */
  acceptTerms: boolean;
}

/** CU-03 · POST /api/auth/verify-email */
export interface VerifyEmailRequest {
  token: string;
}

/** CU-03 · POST /api/auth/resend-verification */
export interface ResendVerificationRequest {
  email: string;
}

/** CU-04 · POST /api/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}

export type Role = "ADOPTER" | "SHELTER" | "ADMIN";

/** The logged-in user: answer of POST /api/auth/login and GET /api/auth/me. */
export interface SessionResponse {
  user: { id: number; email: string; role: Role };
}

/** CU-05 · POST /api/auth/forgot-password */
export interface ForgotPasswordRequest {
  email: string;
}

/** CU-05 · POST /api/auth/reset-password */
export interface ResetPasswordRequest {
  token: string;
  /** RN-175: 12 to 256 characters. */
  password: string;
}

/** GET /api/provinces */
export interface ProvincesResponse {
  provinces: { id: number; name: string }[];
}

export interface ErrorResponse {
  /** Message for the user, in Spanish. */
  error: string;
  /** Invalid input fields and their messages, when the input format is wrong. */
  fields?: Record<string, string>;
}
