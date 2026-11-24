import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/server/config.js";

const minimalEnv = { DATABASE_URL: "postgres://postgres@localhost:5432/lagun" };

describe("T-01 config: environment variables", () => {
  it("reads the database URL and applies defaults for NODE_ENV and PORT", () => {
    const config = loadConfig(minimalEnv);

    expect(config.databaseUrl).toBe("postgres://postgres@localhost:5432/lagun");
    expect(config.nodeEnv).toBe("development");
    expect(config.port).toBe(3000);
  });

  it("reads NODE_ENV and PORT when they are set", () => {
    const config = loadConfig({ ...minimalEnv, NODE_ENV: "production", PORT: "8080" });

    expect(config.nodeEnv).toBe("production");
    expect(config.port).toBe(8080);
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("fails when PORT is not a valid port number", () => {
    expect(() => loadConfig({ ...minimalEnv, PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...minimalEnv, PORT: "70000" })).toThrow(/PORT/);
  });

  it("fails when NODE_ENV is not a known environment", () => {
    expect(() => loadConfig({ ...minimalEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});

describe("T-01 config: configurable parameters (reglas de negocio §16)", () => {
  it("uses the documented default values when no override is set", () => {
    const { rules } = loadConfig(minimalEnv);

    expect(rules).toEqual({
      visitMinNoticeHours: 48, // RN-87
      visitResponseDeadlineHours: 24, // RN-94
      visitCancelMinNoticeHours: 24, // RN-97
      visitAutoCompleteHours: 48, // RN-106
      visitQuotaPerShelter: 3, // RN-90
      visitQuotaWindowMonths: 3, // RN-90
      adoptionReminderIntervalDays: 3, // RN-122
      visitValidityForAdoptionMonths: 1, // RN-116
      handoverReminderIntervalDays: 1, // RN-127
      adoptionCompletionDeadlineDays: 5, // RN-128
      discardDurationDays: 15, // RN-75
      firstBlockDurationDays: 15, // RN-201
      visitReminderNoticeHours: 48, // RN-197
      recurringSlotsMaxRangeMonths: 3, // RN-192
      maxPhotosPerPet: 6, // RN-50
      sessionDurationDays: 30, // RN-176
      sessionRenewalMarginDays: 15, // RN-176
      emailVerificationValidityHours: 24, // RN-177
      passwordResetValidityMinutes: 30, // RN-178
      loginMaxAttempts: 10, // RN-179
      loginAttemptsWindowMinutes: 15, // RN-179
      verificationResendWaitMinutes: 5, // RN-180
      passwordResetResendWaitMinutes: 5, // RN-181
      existingAccountNoticeWaitMinutes: 5, // RN-182
    });
  });

  it("lets an environment variable override a parameter", () => {
    const { rules } = loadConfig({ ...minimalEnv, VISIT_MIN_NOTICE_HOURS: "72", MAX_PHOTOS_PER_PET: "4" });

    expect(rules.visitMinNoticeHours).toBe(72);
    expect(rules.maxPhotosPerPet).toBe(4);
  });

  it("rejects a parameter that is not a positive integer", () => {
    expect(() => loadConfig({ ...minimalEnv, VISIT_QUOTA_PER_SHELTER: "0" })).toThrow(/VISIT_QUOTA_PER_SHELTER/);
    expect(() => loadConfig({ ...minimalEnv, DISCARD_DURATION_DAYS: "1.5" })).toThrow(/DISCARD_DURATION_DAYS/);
    expect(() => loadConfig({ ...minimalEnv, SESSION_DURATION_DAYS: "treinta" })).toThrow(/SESSION_DURATION_DAYS/);
  });

  it("RN-176: rejects a session renewal margin that is not shorter than the session duration", () => {
    expect(() =>
      loadConfig({ ...minimalEnv, SESSION_DURATION_DAYS: "10", SESSION_RENEWAL_MARGIN_DAYS: "10" }),
    ).toThrow(/SESSION_RENEWAL_MARGIN_DAYS/);
  });
});
