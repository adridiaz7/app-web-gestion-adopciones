import { Router } from "express";
import { postRegisterAdopter } from "../controllers/auth.js";

export const authRouter = Router();

authRouter.post("/register/adopter", postRegisterAdopter);
