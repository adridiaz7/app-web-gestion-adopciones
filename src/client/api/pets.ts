import type { BreedsResponse, PetDataRequest, ShelterPetResponse, ShelterPetsResponse } from "../../shared/api.js";
import { apiRequest } from "./client.js";

export const getBreeds = () => apiRequest<BreedsResponse>("GET", "/breeds");

export const listMyPets = () => apiRequest<ShelterPetsResponse>("GET", "/shelter/pets");

export const getMyPet = (id: number) => apiRequest<ShelterPetResponse>("GET", `/shelter/pets/${String(id)}`);

export const createPet = (body: PetDataRequest) => apiRequest<ShelterPetResponse>("POST", "/shelter/pets", body);

export const updatePet = (id: number, body: PetDataRequest) =>
  apiRequest<ShelterPetResponse>("PUT", `/shelter/pets/${String(id)}`, body);
