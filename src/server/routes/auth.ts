import { Router } from "express";
import {
  getMe,
  postLogin,
  postLogout,
  postRegisterAdopter,
  postRegisterShelter,
  postResendVerification,
  postVerifyEmail,
} from "../controllers/auth.js";
import { loginRateLimit } from "../middlewares/login-rate-limit.js";
import { requireAuth } from "../middlewares/session.js";

/** Built per app, so the login rate limit (RN-179) is not shared between app instances. */
export function createAuthRouter(): Router {
  const router = Router();

  router.post("/register/adopter", postRegisterAdopter);
  router.post("/register/shelter", postRegisterShelter);
  router.post("/verify-email", postVerifyEmail);
  router.post("/resend-verification", postResendVerification);
  router.post("/login", loginRateLimit(), postLogin);
  router.post("/logout", postLogout);
  router.get("/me", requireAuth, getMe);

  return router;
}
