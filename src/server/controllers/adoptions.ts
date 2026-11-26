import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AdoptionRequestResponse, AdoptionStatusResponse, CandidatesResponse, HouseholdResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { getHousehold, requestAdoption, type AdoptionAnswers } from "../services/adoption-requests.js";
import { cancelAdoption, deliverAdoption, returnAdoption } from "../services/adoption-closing.js";
import { approveAdoption, listCandidates, rejectAdoption } from "../services/adoption-decisions.js";

const CHOOSE = "Elige una opción.";
const yesNo = z.boolean({ error: CHOOSE });

/** RN-27, RN-117: every household field is required to request an adoption (the description of other pets is optional). */
const householdSchema = z.object(
  {
    housingType: z.enum(["APARTMENT", "HOUSE", "OTHER"], { error: CHOOSE }),
    hasOutdoorSpace: yesNo,
    housingTenure: z.enum(["OWNED", "RENTED", "RENT_TO_OWN"], { error: CHOOSE }),
    householdMembers: z.number({ error: "Indica cuántas personas viven en casa." }).int().min(1, { error: "Al menos 1 persona." }).max(50, { error: "Como mucho 50." }),
    hasChildren: yesNo,
    hasOtherPets: yesNo,
    otherPetsDescription: z
      .string()
      .trim()
      .max(500, { error: "No puede tener más de 500 caracteres." })
      .nullish()
      .transform((text) => (text ? text : null)),
    hasPetExperience: yesNo,
    hoursAlonePerDay: z.number({ error: "Indica cuántas horas estaría sola." }).int().min(0, { error: "Entre 0 y 24 horas." }).max(24, { error: "Entre 0 y 24 horas." }),
  },
  { error: "Completa los datos del hogar." },
);

/** RN-207: two optional questions. */
const answersSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(2000, { error: "No puede tener más de 2000 caracteres." })
      .optional()
      .transform((text) => (text ? text : undefined)),
    canAffordCosts: z.boolean({ error: CHOOSE }).optional(),
  })
  .optional();

const INVALID_PET = "La mascota no es válida.";
const adoptionSchema = z.object({
  petId: z.number({ error: INVALID_PET }).int({ error: INVALID_PET }).positive({ error: INVALID_PET }).max(Number.MAX_SAFE_INTEGER, { error: INVALID_PET }),
  household: householdSchema,
  answers: answersSchema,
});

function userId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/** RN-207 · GET /api/adopter/household */
export const getMyHousehold: RequestHandler = async (req, res) => {
  const body: HouseholdResponse = { household: await getHousehold(userId(req.user)) };
  res.json(body);
};

/** CU-27 · POST /api/adopter/adoptions */
export const postAdoption: RequestHandler = async (req, res) => {
  const { petId, household, answers } = adoptionSchema.parse(req.body ?? {});
  const stored: AdoptionAnswers = {};
  if (answers?.reason !== undefined) stored.reason = answers.reason;
  if (answers?.canAffordCosts !== undefined) stored.canAffordCosts = answers.canAffordCosts;
  const body: AdoptionRequestResponse = { adoption: await requestAdoption(userId(req.user), petId, household, stored) };
  res.status(201).json(body);
};

const ADOPTION_INVALID = "La solicitud no es válida.";
const adoptionParamsSchema = z.object({
  id: z.coerce.number({ error: ADOPTION_INVALID }).int({ error: ADOPTION_INVALID }).positive({ error: ADOPTION_INVALID }).max(Number.MAX_SAFE_INTEGER, { error: ADOPTION_INVALID }),
});
const petParamsSchema = z.object({
  id: z.coerce.number({ error: INVALID_PET }).int({ error: INVALID_PET }).positive({ error: INVALID_PET }).max(Number.MAX_SAFE_INTEGER, { error: INVALID_PET }),
});
/** RN-123: the reason is required. */
const REASON = "Indica el motivo del rechazo.";
const rejectSchema = z.object({
  reason: z.string({ error: REASON }).trim().min(1, { error: REASON }).max(1000, { error: "El motivo no puede tener más de 1000 caracteres." }),
});

/** CU-28 · GET /api/shelter/pets/:id/candidates */
export const getCandidates: RequestHandler = async (req, res) => {
  const { id } = petParamsSchema.parse(req.params);
  const { pet, candidates } = await listCandidates(userId(req.user), id);
  const body: CandidatesResponse = {
    pet,
    candidates: candidates.map((c) => ({ ...c, visitedAt: c.visitedAt.toISOString(), requestedAt: c.requestedAt.toISOString() })),
  };
  res.json(body);
};

/** CU-29 · POST /api/shelter/adoptions/:id/approve */
export const postApproveAdoption: RequestHandler = async (req, res) => {
  const { id } = adoptionParamsSchema.parse(req.params);
  const body: AdoptionStatusResponse = { adoption: await approveAdoption(userId(req.user), id) };
  res.json(body);
};

/** RN-129, RN-131: a required reason for a cancellation or a return. */
const reasonSchema = (message: string) =>
  z.object({
    reason: z.string({ error: message }).trim().min(1, { error: message }).max(1000, { error: "El motivo no puede tener más de 1000 caracteres." }),
  });
const cancelSchema = reasonSchema("Indica el motivo de la cancelación.");
const returnSchema = reasonSchema("Indica el motivo de la devolución.");

/** CU-30 · POST /api/adopter/adoptions/:id/cancel */
export const postAdopterCancelAdoption: RequestHandler = async (req, res) => {
  const { id } = adoptionParamsSchema.parse(req.params);
  const { reason } = cancelSchema.parse(req.body ?? {});
  const body: AdoptionStatusResponse = { adoption: await cancelAdoption("ADOPTER", userId(req.user), id, reason) };
  res.json(body);
};

/** CU-30 · POST /api/shelter/adoptions/:id/cancel */
export const postShelterCancelAdoption: RequestHandler = async (req, res) => {
  const { id } = adoptionParamsSchema.parse(req.params);
  const { reason } = cancelSchema.parse(req.body ?? {});
  const body: AdoptionStatusResponse = { adoption: await cancelAdoption("SHELTER", userId(req.user), id, reason) };
  res.json(body);
};

/** CU-31 · POST /api/shelter/adoptions/:id/deliver */
export const postDeliverAdoption: RequestHandler = async (req, res) => {
  const { id } = adoptionParamsSchema.parse(req.params);
  const body: AdoptionStatusResponse = { adoption: await deliverAdoption(userId(req.user), id) };
  res.json(body);
};

/** CU-32 · POST /api/shelter/adoptions/:id/return */
export const postReturnAdoption: RequestHandler = async (req, res) => {
  const { id } = adoptionParamsSchema.parse(req.params);
  const { reason } = returnSchema.parse(req.body ?? {});
  const body: AdoptionStatusResponse = { adoption: await returnAdoption(userId(req.user), id, reason) };
  res.json(body);
};

/** CU-29 · POST /api/shelter/adoptions/:id/reject */
export const postRejectAdoption: RequestHandler = async (req, res) => {
  const { id } = adoptionParamsSchema.parse(req.params);
  const { reason } = rejectSchema.parse(req.body ?? {});
  const body: AdoptionStatusResponse = { adoption: await rejectAdoption(userId(req.user), id, reason) };
  res.json(body);
};
