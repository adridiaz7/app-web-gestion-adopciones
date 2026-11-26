import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdopterBlockResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { blockAdopter, getActiveBlock, unblockAdopter, type Block } from "../services/adopter-blocks.js";

const INVALID_ADOPTER = "El adoptante no es válido.";
const paramsSchema = z.object({
  id: z.coerce
    .number({ error: INVALID_ADOPTER })
    .int({ error: INVALID_ADOPTER })
    .positive({ error: INVALID_ADOPTER })
    .max(Number.MAX_SAFE_INTEGER, { error: INVALID_ADOPTER }),
});

/** RN-147: a reason from the list and an optional detail. */
const blockSchema = z.object({
  reason: z.enum(["INAPPROPRIATE_BEHAVIOUR", "FALSE_INFORMATION", "BREACHES", "OTHER"], { error: "Elige el motivo del bloqueo." }),
  detail: z
    .string()
    .trim()
    .max(1000, { error: "No puede tener más de 1000 caracteres." })
    .nullish()
    .transform((text) => (text ? text : null)),
});

function shelterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

const toBody = (block: Block | null): AdopterBlockResponse => ({
  block: block && { ...block, createdAt: block.createdAt.toISOString(), endsAt: block.endsAt ? block.endsAt.toISOString() : null },
});

/** CU-35 · GET /api/shelter/adopters/:id/block */
export const getAdopterBlock: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  res.json(toBody(await getActiveBlock(shelterId(req.user), id)));
};

/** CU-35 · POST /api/shelter/adopters/:id/block */
export const postAdopterBlock: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const { reason, detail } = blockSchema.parse(req.body ?? {});
  res.status(201).json(toBody(await blockAdopter(shelterId(req.user), id, reason, detail)));
};

/** CU-35 · POST /api/shelter/adopters/:id/unblock */
export const postAdopterUnblock: RequestHandler = async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  await unblockAdopter(shelterId(req.user), id);
  res.json(toBody(null));
};
