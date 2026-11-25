import type {
  BreedsResponse,
  GalleryResponse,
  PetProfileResponse,
  PetDataRequest,
  PetPhotosResponse,
  PhotoOrderRequest,
  ShelterPetResponse,
  ShelterPetsResponse,
  UnlistPetRequest,
} from "../../shared/api.js";
import { apiRequest } from "./client.js";

export const getBreeds = () => apiRequest<BreedsResponse>("GET", "/breeds");

/** CU-09: `query` comes from galleryQueryString ("" or "?…"). */
export const getGallery = (query: string) => apiRequest<GalleryResponse>("GET", `/pets${query}`);

/** CU-11: only with a session (RN-188). */
export const getPetProfile = (id: number) => apiRequest<PetProfileResponse>("GET", `/pets/${String(id)}`);

export const listMyPets = () => apiRequest<ShelterPetsResponse>("GET", "/shelter/pets");

export const getMyPet = (id: number) => apiRequest<ShelterPetResponse>("GET", `/shelter/pets/${String(id)}`);

export const createPet = (body: PetDataRequest) => apiRequest<ShelterPetResponse>("POST", "/shelter/pets", body);

export const updatePet = (id: number, body: PetDataRequest) =>
  apiRequest<ShelterPetResponse>("PUT", `/shelter/pets/${String(id)}`, body);

const photosPath = (petId: number) => `/shelter/pets/${String(petId)}/photos`;

export const listPetPhotos = (petId: number) => apiRequest<PetPhotosResponse>("GET", photosPath(petId));

export function uploadPetPhoto(petId: number, file: File): Promise<PetPhotosResponse> {
  const form = new FormData();
  form.append("photo", file);
  return apiRequest<PetPhotosResponse>("POST", photosPath(petId), form);
}

export const deletePetPhoto = (petId: number, photoId: number) =>
  apiRequest<PetPhotosResponse>("DELETE", `${photosPath(petId)}/${String(photoId)}`);

export const reorderPetPhotos = (petId: number, photoIds: number[]) =>
  apiRequest<PetPhotosResponse>("PUT", `${photosPath(petId)}/order`, { photoIds } satisfies PhotoOrderRequest);

/** CU-17, RN-62: unlist an available pet with a reason. */
export const unlistPet = (id: number, body: UnlistPetRequest) =>
  apiRequest<ShelterPetResponse>("POST", `/shelter/pets/${String(id)}/unlist`, body);

/** CU-17, RN-63: make an unlisted pet available again. */
export const reactivatePet = (id: number) => apiRequest<ShelterPetResponse>("POST", `/shelter/pets/${String(id)}/reactivate`);
