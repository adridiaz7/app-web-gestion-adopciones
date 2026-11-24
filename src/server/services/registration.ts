import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { withTransaction, type Db } from "../db/transaction.js";
import { BadRequestError, ConflictError } from "../errors.js";
import { insertAdopter } from "../models/adopters.js";
import { provinceExists } from "../models/provinces.js";
import { cifExists, insertShelterIfCifFree } from "../models/shelters.js";
import { claimExistingAccountNotice, insertUserIfEmailFree } from "../models/users.js";
import { createVerificationEmail } from "./email-verification.js";
import { sendEmail, type Email } from "./email.js";
import { hashPassword } from "./passwords.js";

/** Age of majority in Spain (RN-25). A legal fact, not a configurable parameter of §16. */
const ADULT_AGE = 18;

/**
 * RN-25: whether someone born on `birthDate` is an adult on `today` (both `YYYY-MM-DD`).
 * Someone born on 29 February becomes an adult on 1 March in non-leap years.
 */
export function isAdult(birthDate: string, today: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) throw new Error(`Invalid date: ${birthDate}`);
  const [birthYear, birthMonth, birthDay] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const adultFrom = new Date(Date.UTC(birthYear + ADULT_AGE, birthMonth - 1, birthDay));
  // Date.UTC rolls 29 February over to 1 March when the year is not a leap year.
  return adultFrom.toISOString().slice(0, 10) <= today;
}

const madridDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" });

/** Today's date in Spain, as `YYYY-MM-DD`. */
function madridToday(): string {
  return madridDate.format(new Date());
}

export interface AdopterRegistration extends AccountRegistration {
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string;
  locality: string;
}

/** RN-182: notice to the owner of an email someone tried to sign up with. */
function existingAccountEmail(to: string): Email {
  return {
    to,
    subject: "Alguien ha intentado registrarse con tu email",
    text: [
      "Alguien ha intentado registrarse con tu email, pero ya tienes una cuenta.",
      "",
      "Si has sido tú y no recuerdas la contraseña, puedes recuperarla aquí:",
      `${getConfig().appUrl}/recuperar-contrasena`,
      "",
      "Si no has sido tú, puedes ignorar este mensaje: tu cuenta no ha cambiado.",
    ].join("\n"),
  };
}

/** Data that every sign-up has, whatever the role. */
interface AccountRegistration {
  /** Already trimmed and lower-cased by the controller. */
  email: string;
  password: string;
  provinceId: number;
  acceptTerms: boolean;
}

/**
 * Common part of CU-01 and CU-02. Checks the terms and the province, then creates the
 * account and its profile (`insertProfile`) in one transaction. The account stays
 * unverified until the email link is used (RN-07). The emails go out after the commit,
 * so no link is sent for an account that was not saved.
 */
async function registerAccount(
  input: AccountRegistration,
  role: "ADOPTER" | "SHELTER",
  insertProfile: (client: Db, userId: number) => Promise<void>,
): Promise<void> {
  const { rules } = getConfig();

  // RN-186: accepting the terms of use and the privacy policy is mandatory.
  if (!input.acceptTerms) {
    throw new BadRequestError("Tienes que aceptar los términos de uso y la política de privacidad.");
  }
  if (!(await provinceExists(getPool(), input.provinceId))) {
    throw new BadRequestError("La provincia no existe.");
  }

  // Hashed before knowing whether the email is free, so the response time does not reveal it (RN-182).
  const passwordHash = await hashPassword(input.password);

  const emails = await withTransaction(async (client) => {
    const user = await insertUserIfEmailFree(client, { email: input.email, passwordHash, role });
    if (!user) {
      // RN-182: the email already has an account. Same answer as a new email; the owner is told instead.
      const owner = await claimExistingAccountNotice(client, input.email, rules.existingAccountNoticeWaitMinutes);
      return owner ? [existingAccountEmail(owner.email)] : [];
    }

    await insertProfile(client, user.id);
    // RN-177: the verification link expires after the configured hours.
    return [await createVerificationEmail(client, user.id, input.email)];
  });

  for (const email of emails) await sendEmail(email);
}

/** CU-01: signs up an adopter. */
export async function registerAdopter(input: AdopterRegistration): Promise<void> {
  // RN-25: adopters must be adults, counting in Spanish time.
  if (!isAdult(input.birthDate, madridToday())) {
    throw new BadRequestError("Tienes que ser mayor de edad para registrarte.");
  }

  await registerAccount(input, "ADOPTER", (client, userId) =>
    insertAdopter(client, {
      userId,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      birthDate: input.birthDate,
      provinceId: input.provinceId,
      locality: input.locality,
    }),
  );
}

export interface ShelterRegistration extends AccountRegistration {
  name: string;
  /** Already normalised by the controller (upper case, no spaces or hyphens). */
  cif: string;
  address: string;
  locality: string;
  phone: string;
}

const CIF_TAKEN = "Ya hay una protectora registrada con ese CIF.";

/**
 * CU-02: signs up a shelter, pending validation by the administrator (RN-14).
 * RN-17: a CIF already registered is rejected before looking at the email, so the
 * answer is the same whether the email has an account or not (RN-182).
 */
export async function registerShelter(input: ShelterRegistration): Promise<void> {
  if (await cifExists(getPool(), input.cif)) throw new ConflictError(CIF_TAKEN);

  await registerAccount(input, "SHELTER", async (client, userId) => {
    const inserted = await insertShelterIfCifFree(client, {
      userId,
      name: input.name,
      cif: input.cif,
      address: input.address,
      provinceId: input.provinceId,
      locality: input.locality,
      phone: input.phone,
    });
    // Another sign-up took the CIF meanwhile: the transaction rolls back the new account.
    if (!inserted) throw new ConflictError(CIF_TAKEN);
  });
}
