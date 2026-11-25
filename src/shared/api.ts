// Types shared by the server and the client. Types only: the browser cannot load npm packages.

export interface HealthResponse {
  status: "ok";
}

/** Answer of an action that only reports what happened, with a message for the user. */
export interface MessageResponse {
  message: string;
}

/** CU-01 · POST /api/auth/register/adopter */
export interface AdopterRegistrationRequest {
  email: string;
  /** RN-175: 12 to 256 characters. */
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** YYYY-MM-DD. RN-25: must be an adult. */
  birthDate: string;
  provinceId: number;
  locality: string;
  /** RN-186: must be true. */
  acceptTerms: boolean;
}

/** CU-02 · POST /api/auth/register/shelter */
export interface ShelterRegistrationRequest {
  email: string;
  /** RN-175: 12 to 256 characters. */
  password: string;
  name: string;
  /** RN-17: unique. Spaces and hyphens are ignored. */
  cif: string;
  address: string;
  provinceId: number;
  locality: string;
  phone: string;
  /** RN-186: must be true. */
  acceptTerms: boolean;
}

/** CU-03 · POST /api/auth/verify-email */
export interface VerifyEmailRequest {
  token: string;
}

/** CU-03 · POST /api/auth/resend-verification */
export interface ResendVerificationRequest {
  email: string;
}

/** CU-04 · POST /api/auth/login */
export interface LoginRequest {
  email: string;
  password: string;
}

export type Role = "ADOPTER" | "SHELTER" | "ADMIN";

/** The logged-in user: answer of POST /api/auth/login and GET /api/auth/me. */
export interface SessionResponse {
  user: { id: number; email: string; role: Role };
}

/** CU-05 · POST /api/auth/forgot-password */
export interface ForgotPasswordRequest {
  email: string;
}

/** CU-05 · POST /api/auth/reset-password */
export interface ResetPasswordRequest {
  token: string;
  /** RN-175: 12 to 256 characters. */
  password: string;
}

/** GET /api/provinces */
export interface ProvincesResponse {
  provinces: { id: number; name: string }[];
}

export type ValidationStatus = "PENDING" | "VALIDATED" | "REJECTED";

/** A shelter as the administrator sees it to manage its validation (CU-39). */
export interface AdminShelter {
  id: number;
  name: string;
  cif: string;
  email: string;
  phone: string;
  address: string;
  locality: string;
  provinceName: string;
  validationStatus: ValidationStatus;
  validationReason: string | null;
  /** ISO dates. */
  registeredAt: string;
  validatedAt: string | null;
}

/** CU-39 · GET /api/admin/shelters */
export interface AdminSheltersResponse {
  shelters: AdminShelter[];
}

/** CU-39 · POST /api/admin/shelters/:id/validate, /reject and /revoke */
export interface AdminShelterResponse {
  shelter: AdminShelter;
}

/** CU-39 · body of POST /api/admin/shelters/:id/reject and /revoke */
export interface ReasonRequest {
  reason: string;
}

/** GET /api/breeds (RN-39, RN-40) */
export interface BreedsResponse {
  species: { id: number; name: string; breeds: { id: number; name: string }[] }[];
}

export type PetStatus = "AVAILABLE" | "RESERVED" | "ADOPTED" | "UNLISTED";

/** Body of POST /api/shelter/pets and PUT /api/shelter/pets/:id (CU-15, CU-16). */
export interface PetDataRequest {
  breedId: number;
  name: string;
  description: string;
  /** YYYY-MM-DD, approximate (RN-43). */
  birthDate: string;
  sex: "MALE" | "FEMALE";
  size: "SMALL" | "MEDIUM" | "LARGE";
  activityLevel: "LOW" | "MEDIUM" | "HIGH";
  goodWithChildren: "YES" | "NO" | "UNKNOWN";
  /** RN-46: one entry per species; a species without an entry is unknown. */
  getsAlongWith: { speciesId: number; getsAlong: boolean }[];
  vaccinated: boolean;
  dewormed: boolean;
  sterilized: boolean;
  microchipped: boolean;
  specialNeeds: string | null;
}

/** A pet as its shelter sees it. */
export interface ShelterPet extends PetDataRequest {
  id: number;
  speciesId: number;
  speciesName: string;
  breedName: string;
  status: PetStatus;
  /** ISO date (RN-49). */
  createdAt: string;
}

/** CU-14 · GET /api/shelter/pets */
export interface ShelterPetsResponse {
  pets: ShelterPet[];
}

/** CU-15, CU-16 · POST /api/shelter/pets, GET and PUT /api/shelter/pets/:id */
export interface ShelterPetResponse {
  pet: ShelterPet;
}

/** A pet's photo (RN-51, RN-52). */
export interface PetPhoto {
  id: number;
  /** Public path of the image, under /uploads. */
  url: string;
  /** 1 is the main photo. */
  position: number;
}

/** CU-15, CU-16 · GET, POST /api/shelter/pets/:id/photos, DELETE …/photos/:photoId, PUT …/photos/order */
export interface PetPhotosResponse {
  photos: PetPhoto[];
  /** RN-50: the configured maximum of photos per pet. */
  maxPhotos: number;
}

/** CU-16 · PUT /api/shelter/pets/:id/photos/order */
export interface PhotoOrderRequest {
  photoIds: number[];
}

export interface ErrorResponse {
  /** Message for the user, in Spanish. */
  error: string;
  /** Invalid input fields and their messages, when the input format is wrong. */
  fields?: Record<string, string>;
}
