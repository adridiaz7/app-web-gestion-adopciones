import type { Request, RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import type { PetPhotosResponse } from "../../shared/api.js";
import { getConfig } from "../config.js";
import { BadRequestError, UnauthorizedError } from "../errors.js";
import { addPetPhoto, listPetPhotos, removePetPhoto, reorderPetPhotos } from "../services/pet-photos.js";

const id = (message: string) => z.coerce.number({ error: message }).int({ error: message }).positive({ error: message }).max(Number.MAX_SAFE_INTEGER, { error: message });

const petParamsSchema = z.object({ id: id("La mascota no es válida.") });
const photoParamsSchema = petParamsSchema.extend({ photoId: id("La foto no es válida.") });
const orderSchema = z.object({
  photoIds: z.array(id("La foto no es válida."), { error: "Indica el orden de las fotos." }).max(100),
});

/** RN-50: the list, with the configured maximum so the screen does not hard-code it. */
const photosBody = (photos: PetPhotosResponse["photos"]): PetPhotosResponse => ({ photos, maxPhotos: getConfig().rules.maxPhotosPerPet });

function shelterId(user: Request["user"]): number {
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/**
 * Reads one image from the multipart field `field` into memory, limited to the configured
 * size, and translates multer's errors into messages for the user. `noun` names the file
 * in them ("foto", "logo").
 */
export function receiveImage(field: string, noun: string): RequestHandler {
  return (req, res, next) => {
    const { maxPhotoSizeMb } = getConfig();
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxPhotoSizeMb * 1024 * 1024, files: 1 },
    }).single(field);

    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        const article = noun === "foto" ? "La" : "El";
        next(
          new BadRequestError(
            error.code === "LIMIT_FILE_SIZE"
              ? `${article} ${noun} no puede ocupar más de ${String(maxPhotoSizeMb)} MB.`
              : `Sube ${article === "La" ? "una sola" : "un solo"} ${noun} en el campo «${field}».`,
          ),
        );
        return;
      }
      next(error);
    });
  };
}

/** The pet photos come in the multipart field "photo". */
export const receivePhoto = receiveImage("photo", "foto");

/** CU-16 · GET /api/shelter/pets/:id/photos */
export const getPhotos: RequestHandler = async (req, res) => {
  const { id: petId } = petParamsSchema.parse(req.params);
  res.json(photosBody(await listPetPhotos(shelterId(req.user), petId)));
};

/** CU-15, CU-16 · POST /api/shelter/pets/:id/photos (multipart, field "photo") */
export const postPhoto: RequestHandler = async (req, res) => {
  const { id: petId } = petParamsSchema.parse(req.params);
  if (!req.file) throw new BadRequestError("Elige una foto.");
  res.status(201).json(photosBody(await addPetPhoto(shelterId(req.user), petId, req.file.buffer)));
};

/** CU-16 · DELETE /api/shelter/pets/:id/photos/:photoId */
export const deletePhoto: RequestHandler = async (req, res) => {
  const { id: petId, photoId } = photoParamsSchema.parse(req.params);
  res.json(photosBody(await removePetPhoto(shelterId(req.user), petId, photoId)));
};

/** CU-16 · PUT /api/shelter/pets/:id/photos/order */
export const putPhotoOrder: RequestHandler = async (req, res) => {
  const { id: petId } = petParamsSchema.parse(req.params);
  const { photoIds } = orderSchema.parse(req.body ?? {});
  res.json(photosBody(await reorderPetPhotos(shelterId(req.user), petId, photoIds)));
};
