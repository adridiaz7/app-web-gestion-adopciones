import type {
  AdopterRegistrationRequest,
  ChangeEmailRequest,
  ChangePasswordRequest,
  ConfirmEmailChangeRequest,
  DeleteAccountRequest,
  ForgotPasswordRequest,
  LoginRequest,
  MessageResponse,
  ProvincesResponse,
  ResendVerificationRequest,
  ResetPasswordRequest,
  SessionResponse,
  ShelterRegistrationRequest,
  VerifyEmailRequest,
} from "../../shared/api.js";
import { ApiError, apiRequest } from "./client.js";

export type SessionUser = SessionResponse["user"];

export const registerAdopter = (body: AdopterRegistrationRequest) =>
  apiRequest<MessageResponse>("POST", "/auth/register/adopter", body);

export const registerShelter = (body: ShelterRegistrationRequest) =>
  apiRequest<MessageResponse>("POST", "/auth/register/shelter", body);

export const verifyEmail = (body: VerifyEmailRequest) => apiRequest<MessageResponse>("POST", "/auth/verify-email", body);

export const resendVerification = (body: ResendVerificationRequest) =>
  apiRequest<MessageResponse>("POST", "/auth/resend-verification", body);

export const login = (body: LoginRequest) => apiRequest<SessionResponse>("POST", "/auth/login", body);

export const logout = () => apiRequest<undefined>("POST", "/auth/logout");

/** CU-07: deletes the account and closes the session. */
export const changePassword = (body: ChangePasswordRequest) => apiRequest<undefined>("POST", "/auth/change-password", body);

export const changeEmail = (body: ChangeEmailRequest) => apiRequest<MessageResponse>("POST", "/auth/change-email", body);

export const confirmEmailChange = (body: ConfirmEmailChangeRequest) =>
  apiRequest<MessageResponse>("POST", "/auth/confirm-email-change", body);

export const deleteAccount = (body: DeleteAccountRequest) => apiRequest<undefined>("POST", "/auth/delete-account", body);

export const forgotPassword = (body: ForgotPasswordRequest) =>
  apiRequest<MessageResponse>("POST", "/auth/forgot-password", body);

export const resetPassword = (body: ResetPasswordRequest) =>
  apiRequest<MessageResponse>("POST", "/auth/reset-password", body);

export const getProvinces = () => apiRequest<ProvincesResponse>("GET", "/provinces");

/** The logged-in user, or null without a session. */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    return (await apiRequest<SessionResponse>("GET", "/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
