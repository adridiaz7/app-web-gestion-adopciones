/**
 * Prints the Argon2id hash (RN-08) of each password given, one per line, to paste into
 * db/seed.sql. Same library and defaults as the app (src/server/services/passwords.ts).
 *
 * Run with: node scripts/hash-password.ts "<password>" ["<password>"…]
 */
import { hash } from "@node-rs/argon2";

const passwords = process.argv.slice(2);
if (passwords.length === 0) {
  console.error('Usage: node scripts/hash-password.ts "<password>" ["<password>"…]');
  process.exit(1);
}

for (const password of passwords) {
  if (password.length < 12 || password.length > 256) {
    console.error(`"${password}" does not follow RN-175 (12 to 256 characters).`);
    process.exit(1);
  }
  console.log(await hash(password));
}
