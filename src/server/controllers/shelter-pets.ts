import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { ShelterPetResponse, ShelterPetsResponse } from "../../shared/api.js";
import { UnauthorizedError } from "../errors.js";
import { createPet, editPet, getShelterPet, listShelterPets, type ShelterPet } from "../services/pets.js";
import { reactivatePet, unlistPet } from "../services/pet-unlisting.js";

const REQUIRED = "Este campo es obligatorio.";
const CHOOSE = "Elige una opción.";

const requiredText = (max: number) =>
  z
    .string({ error: REQUIRED })
    .trim()
    .min(1, { error: REQUIRED })
    .max(max, { error: `No puede tener más de ${String(max)} caracteres.` });

const yesNo = z.boolean({ error: CHOOSE });
const catalogueId = (max: number) => z.number({ error: CHOOSE }).int({ error: CHOOSE }).positive({ error: CHOOSE }).max(max, { error: CHOOSE });

/** RN-43 to RN-47: the data of a pet's profile. */
const petDataSchema = z.object({
  name: requiredText(60),
  breedId: catalogueId(2_147_483_647),
  description: requiredText(3000),
  birthDate: z.iso.date({ error: "La fecha de nacimiento no es válida." }),
  sex: z.enum(["MALE", "FEMALE"], { error: CHOOSE }),
  size: z.enum(["SMALL", "MEDIUM", "LARGE"], { error: CHOOSE }),
  activityLevel: z.enum(["LOW", "MEDIUM", "HIGH"], { error: CHOOSE }),
  goodWithChildren: z.enum(["YES", "NO", "UNKNOWN"], { error: CHOOSE }),
  getsAlongWith: z
    .array(z.object({ speciesId: catalogueId(32767), getsAlong: yesNo }), { error: "La convivencia no es válida." })
    .max(20)
    .default([]),
  vaccinated: yesNo,
  dewormed: yesNo,
  sterilized: yesNo,
  microchipped: yesNo,
  specialNeeds: z
    .string()
    .trim()
    .max(1000, { error: "No puede tener más de 1000 caracteres." })
    .nullish()
    .transform((text) => (text ? text : null)),
});

const idParamsSchema = z.object({
  id: z.coerce.number({ error: "La mascota no es válida." }).int().positive().max(Number.MAX_SAFE_INTEGER),
});

function shelterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

function toResponse(pet: ShelterPet): ShelterPetResponse["pet"] {
  return { ...pet, unlistedAt: pet.unlistedAt?.toISOString() ?? null, createdAt: pet.createdAt.toISOString() };
}

/** CU-14 · GET /api/shelter/pets */
export const getPets: RequestHandler = async (req, res) => {
  const body: ShelterPetsResponse = { pets: (await listShelterPets(shelterId(req.user))).map(toResponse) };
  res.json(body);
};

/** CU-16 · GET /api/shelter/pets/:id */
export const getPet: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const body: ShelterPetResponse = { pet: toResponse(await getShelterPet(shelterId(req.user), id)) };
  res.json(body);
};

/** CU-15 · POST /api/shelter/pets */
export const postPet: RequestHandler = async (req, res) => {
  const data = petDataSchema.parse(req.body ?? {});
  const body: ShelterPetResponse = { pet: toResponse(await createPet(shelterId(req.user), data)) };
  res.status(201).json(body);
};

/** CU-16 · PUT /api/shelter/pets/:id */
export const putPet: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const data = petDataSchema.parse(req.body ?? {});
  const body: ShelterPetResponse = { pet: toResponse(await editPet(shelterId(req.user), id, data)) };
  res.json(body);
};

/** RN-62: the shelter must choose one of its reasons; REMOVED_BY_ADMIN is only for the administrator. */
const unlistSchema = z.object({
  reason: z.enum(["DECEASED", "TRANSFERRED", "TREATMENT", "FOSTER", "ERROR", "OTHER"], { error: "Elige el motivo de la baja." }),
});

/** CU-17 · POST /api/shelter/pets/:id/unlist */
export const postUnlistPet: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const { reason } = unlistSchema.parse(req.body ?? {});
  const body: ShelterPetResponse = { pet: toResponse(await unlistPet(shelterId(req.user), id, reason)) };
  res.json(body);
};

/** CU-17 · POST /api/shelter/pets/:id/reactivate */
export const postReactivatePet: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const body: ShelterPetResponse = { pet: toResponse(await reactivatePet(shelterId(req.user), id)) };
  res.json(body);
};
