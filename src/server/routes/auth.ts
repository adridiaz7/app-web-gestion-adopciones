import { Router } from "express";
import { postRegisterAdopter, postRegisterShelter } from "../controllers/auth.js";

export const authRouter = Router();

authRouter.post("/register/adopter", postRegisterAdopter);
authRouter.post("/register/shelter", postRegisterShelter);
