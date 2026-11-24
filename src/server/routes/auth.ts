import { Router } from "express";
import {
  postRegisterAdopter,
  postRegisterShelter,
  postResendVerification,
  postVerifyEmail,
} from "../controllers/auth.js";

export const authRouter = Router();

authRouter.post("/register/adopter", postRegisterAdopter);
authRouter.post("/register/shelter", postRegisterShelter);
authRouter.post("/verify-email", postVerifyEmail);
authRouter.post("/resend-verification", postResendVerification);
