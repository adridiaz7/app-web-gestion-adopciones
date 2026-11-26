import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdminIncidentsResponse, OpenIncidentResponse } from "../../shared/api.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";
import { changeIncidentStatus, correctAttendance, listIncidents, openIncident } from "../services/incidents.js";

const id = (message: string) => z.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });
const EXPLAIN = "Explica qué ha pasado.";

/** CU-36, RN-166, RN-167: a reason from the list, a required explanation and at most one link. */
const incidentSchema = z
  .object({
    reportedId: id("Indica a quién se refiere la incidencia."),
    reason: z.enum(["WRONG_ATTENDANCE", "INAPPROPRIATE_BEHAVIOUR", "FALSE_INFORMATION", "INAPPROPRIATE_CONTENT", "UNFAIR_BLOCK", "OTHER"], {
      error: "Elige el motivo de la incidencia.",
    }),
    description: z.string({ error: EXPLAIN }).trim().min(1, { error: EXPLAIN }).max(5000, { error: "No puede tener más de 5000 caracteres." }),
    visitId: id("La visita no es válida.").nullish(),
    adoptionId: id("La adopción no es válida.").nullish(),
  })
  .refine((body) => body.visitId == null || body.adoptionId == null, { error: "Liga la incidencia a una visita o a una adopción, no a las dos.", path: ["adoptionId"] });

/** CU-36 · POST /api/incidents */
export const postIncident: RequestHandler = async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { role } = req.user;
  if (role === "ADMIN") throw new ForbiddenError();
  const input = incidentSchema.parse(req.body ?? {});
  const incident = await openIncident(
    { id: req.user.id, role },
    { reportedId: input.reportedId, reason: input.reason, description: input.description, visitId: input.visitId ?? null, adoptionId: input.adoptionId ?? null },
  );
  const body: OpenIncidentResponse = { incident };
  res.status(201).json(body);
};

const STATUS = z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"], { error: "El estado no es válido." });
const listQuerySchema = z.object({ status: STATUS.optional() });
const paramsSchema = z.object({ id: z.coerce.number({ error: "No es válido." }).int({ error: "No es válido." }).positive({ error: "No es válido." }).max(Number.MAX_SAFE_INTEGER, { error: "No es válido." }) });
const RESOLUTION = "Explica la resolución.";

/** RN-168: IN_REVIEW, or a closed status with its resolution. */
const statusSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("IN_REVIEW") }),
    z.object({
      status: z.enum(["RESOLVED", "DISMISSED"]),
      resolution: z.string({ error: RESOLUTION }).trim().min(1, { error: RESOLUTION }).max(5000, { error: "No puede tener más de 5000 caracteres." }),
    }),
  ],
  { error: "El estado no es válido." },
);

function adminId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** CU-37 · GET /api/admin/incidents?status= */
export const getIncidents: RequestHandler = async (req, res) => {
  const { status } = listQuerySchema.parse(req.query);
  const incidents = await listIncidents(status ?? null);
  const body: AdminIncidentsResponse = {
    incidents: incidents.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null })),
  };
  res.json(body);
};

/** CU-37 · POST /api/admin/incidents/:id/status */
export const postIncidentStatus: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const input = statusSchema.parse(req.body ?? {});
  await changeIncidentStatus(adminId(req.user), id, input.status, input.status === "IN_REVIEW" ? null : input.resolution);
  res.json({ incident: { id, status: input.status } });
};

/** CU-38 · POST /api/admin/visits/:id/correct-attendance */
export const postCorrectAttendance: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  res.json({ visit: await correctAttendance(adminId(req.user), id) });
};
