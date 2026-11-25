import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Configuration of the backend: environment variables and the configurable
 * parameters of the business rules (docs/reglas-de-negocio.md §16).
 *
 * Every parameter has the documented default and can be overridden with the
 * environment variable next to it. Business code must read deadlines and limits
 * from `config.rules`, never hard-code them.
 */

export class ConfigError extends Error {
  override name = "ConfigError";
}

const positiveInt = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Public URL of the app, for the links in the emails. Defaults to localhost on PORT.
    APP_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Folder for the uploaded photos, outside git (RN-52). Defaults to uploads/ in the project root.
    UPLOADS_DIR: z.string().min(1).optional(),
    // Maximum size of an uploaded photo (owner's decision of 25/11/2026). Not a §16 parameter.
    MAX_PHOTO_SIZE_MB: positiveInt(5),

    VISIT_MIN_NOTICE_HOURS: positiveInt(48), // RN-87
    VISIT_RESPONSE_DEADLINE_HOURS: positiveInt(24), // RN-94
    VISIT_CANCEL_MIN_NOTICE_HOURS: positiveInt(24), // RN-97
    VISIT_AUTO_COMPLETE_HOURS: positiveInt(48), // RN-106
    VISIT_QUOTA_PER_SHELTER: positiveInt(3), // RN-90
    VISIT_QUOTA_WINDOW_MONTHS: positiveInt(3), // RN-90
    ADOPTION_REMINDER_INTERVAL_DAYS: positiveInt(3), // RN-122
    VISIT_VALIDITY_FOR_ADOPTION_MONTHS: positiveInt(1), // RN-116
    HANDOVER_REMINDER_INTERVAL_DAYS: positiveInt(1), // RN-127
    ADOPTION_COMPLETION_DEADLINE_DAYS: positiveInt(5), // RN-128
    DISCARD_DURATION_DAYS: positiveInt(15), // RN-75
    FIRST_BLOCK_DURATION_DAYS: positiveInt(15), // RN-201
    VISIT_REMINDER_NOTICE_HOURS: positiveInt(48), // RN-197
    RECURRING_SLOTS_MAX_RANGE_MONTHS: positiveInt(3), // RN-192
    MAX_PHOTOS_PER_PET: positiveInt(6), // RN-50
    SESSION_DURATION_DAYS: positiveInt(30), // RN-176
    SESSION_RENEWAL_MARGIN_DAYS: positiveInt(15), // RN-176
    EMAIL_VERIFICATION_VALIDITY_HOURS: positiveInt(24), // RN-177
    PASSWORD_RESET_VALIDITY_MINUTES: positiveInt(30), // RN-178
    LOGIN_MAX_ATTEMPTS: positiveInt(10), // RN-179
    LOGIN_ATTEMPTS_WINDOW_MINUTES: positiveInt(15), // RN-179
    VERIFICATION_RESEND_WAIT_MINUTES: positiveInt(5), // RN-180
    PASSWORD_RESET_RESEND_WAIT_MINUTES: positiveInt(5), // RN-181
    EXISTING_ACCOUNT_NOTICE_WAIT_MINUTES: positiveInt(5), // RN-182
  })
  // RN-176: the session is renewed when less than the margin remains, so the margin must be shorter.
  .refine((env) => env.SESSION_RENEWAL_MARGIN_DAYS < env.SESSION_DURATION_DAYS, {
    path: ["SESSION_RENEWAL_MARGIN_DAYS"],
    message: "must be shorter than SESSION_DURATION_DAYS",
  });

type Env = z.infer<typeof envSchema>;

function toConfig(env: Env) {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    appUrl: (env.APP_URL ?? `http://localhost:${String(env.PORT)}`).replace(/\/+$/, ""),
    uploadsDir: resolve(env.UPLOADS_DIR ?? fileURLToPath(new URL("../../uploads", import.meta.url))),
    maxPhotoSizeMb: env.MAX_PHOTO_SIZE_MB,
    rules: {
      visitMinNoticeHours: env.VISIT_MIN_NOTICE_HOURS,
      visitResponseDeadlineHours: env.VISIT_RESPONSE_DEADLINE_HOURS,
      visitCancelMinNoticeHours: env.VISIT_CANCEL_MIN_NOTICE_HOURS,
      visitAutoCompleteHours: env.VISIT_AUTO_COMPLETE_HOURS,
      visitQuotaPerShelter: env.VISIT_QUOTA_PER_SHELTER,
      visitQuotaWindowMonths: env.VISIT_QUOTA_WINDOW_MONTHS,
      adoptionReminderIntervalDays: env.ADOPTION_REMINDER_INTERVAL_DAYS,
      visitValidityForAdoptionMonths: env.VISIT_VALIDITY_FOR_ADOPTION_MONTHS,
      handoverReminderIntervalDays: env.HANDOVER_REMINDER_INTERVAL_DAYS,
      adoptionCompletionDeadlineDays: env.ADOPTION_COMPLETION_DEADLINE_DAYS,
      discardDurationDays: env.DISCARD_DURATION_DAYS,
      firstBlockDurationDays: env.FIRST_BLOCK_DURATION_DAYS,
      visitReminderNoticeHours: env.VISIT_REMINDER_NOTICE_HOURS,
      recurringSlotsMaxRangeMonths: env.RECURRING_SLOTS_MAX_RANGE_MONTHS,
      maxPhotosPerPet: env.MAX_PHOTOS_PER_PET,
      sessionDurationDays: env.SESSION_DURATION_DAYS,
      sessionRenewalMarginDays: env.SESSION_RENEWAL_MARGIN_DAYS,
      emailVerificationValidityHours: env.EMAIL_VERIFICATION_VALIDITY_HOURS,
      passwordResetValidityMinutes: env.PASSWORD_RESET_VALIDITY_MINUTES,
      loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
      loginAttemptsWindowMinutes: env.LOGIN_ATTEMPTS_WINDOW_MINUTES,
      verificationResendWaitMinutes: env.VERIFICATION_RESEND_WAIT_MINUTES,
      passwordResetResendWaitMinutes: env.PASSWORD_RESET_RESEND_WAIT_MINUTES,
      existingAccountNoticeWaitMinutes: env.EXISTING_ACCOUNT_NOTICE_WAIT_MINUTES,
    },
  } as const;
}

export type Config = ReturnType<typeof toConfig>;
export type RuleParams = Config["rules"];

/** Validates the environment and builds the configuration. Throws ConfigError listing every invalid variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  return toConfig(result.data);
}

let cached: Config | undefined;

/** Configuration read from process.env, loaded once. */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
