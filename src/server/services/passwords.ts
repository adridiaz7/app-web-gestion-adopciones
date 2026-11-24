import { hash, verify } from "@node-rs/argon2";

/** RN-08: passwords are stored as an Argon2id hash (the library default), with a random salt. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Whether `password` matches `passwordHash`. A malformed hash never matches. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
