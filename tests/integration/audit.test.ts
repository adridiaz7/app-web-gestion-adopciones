import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "../../src/server/db/pool.js";
import { withTransaction } from "../../src/server/db/transaction.js";
import { audit } from "../../src/server/services/audit.js";
import { truncateAll } from "../helpers/db.js";
import { createAdmin, createShelter } from "../helpers/factories.js";

interface AuditRow {
  actor_user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: unknown;
  ip_address: string | null;
}

async function auditRows(): Promise<AuditRow[]> {
  const { rows } = await getPool().query<AuditRow>(
    `SELECT actor_user_id, action, entity_type, entity_id, details, host(ip_address) AS ip_address
       FROM "Audit_log" ORDER BY id`,
  );
  return rows;
}

describe("T-03 audit()", () => {
  beforeEach(truncateAll);

  it("RN-208: records who did the action, on which entity and what changed", async () => {
    const admin = await createAdmin();
    const shelter = await createShelter({ validationStatus: "PENDING" });

    await audit(getPool(), {
      actorUserId: admin.id,
      action: "SHELTER_VALIDATED",
      entityType: "Shelter",
      entityId: shelter.id,
      details: { before: { validationStatus: "PENDING" }, after: { validationStatus: "VALIDATED" } },
    });

    expect(await auditRows()).toEqual([
      {
        actor_user_id: admin.id,
        action: "SHELTER_VALIDATED",
        entity_type: "Shelter",
        entity_id: shelter.id,
        details: { before: { validationStatus: "PENDING" }, after: { validationStatus: "VALIDATED" } },
        ip_address: null,
      },
    ]);
  });

  it("RN-208: records system actions and security events without actor, with the IP address", async () => {
    await audit(getPool(), {
      actorUserId: null,
      action: "LOGIN_FAILED",
      details: { email: "nadie@example.test" },
      ipAddress: "192.168.1.20",
    });

    expect(await auditRows()).toEqual([
      {
        actor_user_id: null,
        action: "LOGIN_FAILED",
        entity_type: null,
        entity_id: null,
        details: { email: "nadie@example.test" },
        ip_address: "192.168.1.20",
      },
    ]);
  });

  it("RN-208: the entry belongs to the action's transaction and disappears if the action rolls back", async () => {
    const admin = await createAdmin();

    await expect(
      withTransaction(async (client) => {
        await audit(client, { actorUserId: admin.id, action: "CATALOGUE_UPDATED" });
        throw new Error("the action failed");
      }),
    ).rejects.toThrow("the action failed");

    expect(await auditRows()).toEqual([]);
  });

  it("RN-209: never stores passwords, hashes or tokens, even nested in the details", async () => {
    await audit(getPool(), {
      actorUserId: null,
      action: "PASSWORD_RESET",
      details: {
        email: "ane@example.test",
        password: "secreta123456",
        newPassword: "otra-secreta-123",
        before: { password_hash: "$argon2id$...", passwordHash: "$argon2id$..." },
        token: "abc",
        tokenHash: "def",
        emails: [{ resetToken: "ghi", to: "ane@example.test" }],
      },
    });

    const [row] = await auditRows();
    expect(row?.details).toEqual({
      email: "ane@example.test",
      before: {},
      emails: [{ to: "ane@example.test" }],
    });
  });
});
