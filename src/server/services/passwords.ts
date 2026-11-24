import { hash } from "@node-rs/argon2";

/** RN-08: passwords are stored as an Argon2id hash (the library default), with a random salt. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}
