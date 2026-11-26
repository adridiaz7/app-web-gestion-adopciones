import { Router } from "express";
import {
  getMe,
  postChangeEmail,
  postChangePassword,
  postConfirmEmailChange,
  postForgotPassword,
  postLogin,
  postDeleteAccount,
  postLogout,
  postRegisterAdopter,
  postRegisterShelter,
  postResetPassword,
  postResendVerification,
  postVerifyEmail,
} from "../controllers/auth.js";
import { loginRateLimit } from "../middlewares/login-rate-limit.js";
import { requireAuth, requireRole } from "../middlewares/session.js";

/** Built per app, so the login rate limit (RN-179) is not shared between app instances. */
export function createAuthRouter(): Router {
  const router = Router();

  router.post("/register/adopter", postRegisterAdopter);
  router.post("/register/shelter", postRegisterShelter);
  router.post("/verify-email", postVerifyEmail);
  router.post("/resend-verification", postResendVerification);
  router.post("/login", loginRateLimit(), postLogin);
  router.post("/logout", postLogout);
  router.post("/forgot-password", postForgotPassword);
  router.post("/reset-password", postResetPassword);
  router.get("/me", requireAuth, getMe);
  router.post("/delete-account", requireRole("ADOPTER", "SHELTER"), postDeleteAccount);
  router.post("/change-password", requireRole("ADOPTER", "SHELTER"), postChangePassword);
  router.post("/change-email", requireRole("ADOPTER", "SHELTER"), postChangeEmail);
  router.post("/confirm-email-change", postConfirmEmailChange);

  return router;
}
