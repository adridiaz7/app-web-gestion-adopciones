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

/** A gallery card (CU-09, RN-187). */
export interface GalleryPet {
  id: number;
  name: string;
  speciesName: string;
  breedName: string;
  /** YYYY-MM-DD; the age is shown from it (RN-205). */
  birthDate: string;
  sex: "MALE" | "FEMALE";
  size: "SMALL" | "MEDIUM" | "LARGE";
  /** The main photo (RN-51), or null without photos. */
  photoUrl: string | null;
  shelterName: string;
  provinceName: string;
}

/** CU-09 · GET /api/pets, newest first. */
export interface GalleryResponse {
  pets: GalleryPet[];
}

/** CU-09 · query of GET /api/pets (RN-189, RN-205). All optional; ages in months. */
export interface GalleryQuery {
  speciesId?: number;
  breedId?: number;
  size?: "SMALL" | "MEDIUM" | "LARGE";
  sex?: "MALE" | "FEMALE";
  provinceId?: number;
  minAgeMonths?: number;
  maxAgeMonths?: number;
}

/** CU-11 · GET /api/pets/:id: the whole profile of a visible pet. */
export interface PetProfile {
  id: number;
  name: string;
  description: string;
  speciesName: string;
  breedName: string;
  /** YYYY-MM-DD; the age is shown from it (RN-205). */
  birthDate: string;
  sex: "MALE" | "FEMALE";
  size: "SMALL" | "MEDIUM" | "LARGE";
  activityLevel: "LOW" | "MEDIUM" | "HIGH";
  goodWithChildren: "YES" | "NO" | "UNKNOWN";
  /** RN-46: only the species with a record; any other is unknown. */
  getsAlongWith: { speciesName: string; getsAlong: boolean }[];
  vaccinated: boolean;
  dewormed: boolean;
  sterilized: boolean;
  microchipped: boolean;
  specialNeeds: string | null;
  /** In order; the first is the main one (RN-51). */
  photos: PetPhoto[];
  shelter: { id: number; name: string; locality: string; provinceName: string };
}

export interface PetProfileResponse {
  pet: PetProfile;
}

/** A shelter card in the search (CU-13). */
export interface ShelterCard {
  id: number;
  name: string;
  description: string | null;
  logoUrl: string | null;
  locality: string;
  provinceName: string;
  /** Pets this adopter can see (0 when the shelter blocked them, RN-77). */
  availablePets: number;
}

/** CU-13 · GET /api/shelters?name=&provinceId= */
export interface SheltersResponse {
  shelters: ShelterCard[];
}

/** CU-13 · GET /api/shelters/:id */
export interface ShelterPageResponse {
  shelter: {
    id: number;
    name: string;
    description: string | null;
    logoUrl: string | null;
    address: string;
    locality: string;
    provinceName: string;
    phone: string;
    contactEmail: string | null;
    website: string | null;
    openingHours: string | null;
  };
  /** RN-149: the shelter has restricted this adopter's access; endsAt null = permanent. */
  block: { endsAt: string | null } | null;
  /** Available pets; empty while there is a block (RN-77). */
  pets: GalleryPet[];
}

/**
 * CU-08 · the preferences questionnaire (RN-32). Empty lists and nulls mean "me da igual"
 * (RN-34, RN-35). Ages in months (RN-205).
 */
export interface Preferences {
  speciesIds: number[];
  breedIds: number[];
  sizes: ("SMALL" | "MEDIUM" | "LARGE")[];
  sexes: ("MALE" | "FEMALE")[];
  activityLevels: ("LOW" | "MEDIUM" | "HIGH")[];
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  /** RN-36. */
  needsGoodWithChildren: boolean;
  /** RN-37: the pet must get along with all of them. */
  mustGetAlongWithSpeciesIds: number[];
}

/** CU-08 · GET and PUT /api/adopter/preferences (the PUT body is a Preferences). null = never filled in. */
export interface PreferencesResponse {
  preferences: Preferences | null;
}

/**
 * CU-10 · GET /api/adopter/discover, and the answer of POST …/pets/:id/favorite,
 * …/pets/:id/discard and …/undo ({ petId }): the next pet to rate.
 */
export interface DiscoverResponse {
  /** null = no compatible pets left (CU-10). */
  pet: GalleryPet | null;
  /** Compatible pets left to rate, this one included. */
  remaining: number;
  /** RN-190: false = no questionnaire yet. */
  hasPreferences: boolean;
}

/** CU-10 · body of POST /api/adopter/discover/undo (RN-191). */
export interface UndoDiscardRequest {
  petId: number;
}

/** CU-12 · a favourite keeps its pet's status (reserved, adopted…). */
export interface FavoritePet extends GalleryPet {
  status: PetStatus;
}

/** CU-12 · GET /api/adopter/favorites, most recent first. PUT and DELETE …/favorites/:petId add and remove. */
export interface FavoritesResponse {
  favorites: FavoritePet[];
}

/** CU-12 · GET /api/adopter/discards: discards still in force. DELETE …/discards/:petId recovers one. */
export interface DiscardsResponse {
  discards: GalleryPet[];
}

/** CU-18 · a slot of the shelter's calendar. Dates are ISO instants. */
export interface ShelterSlot {
  id: number;
  startsAt: string;
  endsAt: string;
  capacity: number;
  /** RN-82: places taken by PENDING and CONFIRMED visits. */
  occupied: number;
  visits: { id: number; petName: string; adopterName: string; status: string }[];
}

/** CU-18 · GET /api/shelter/slots */
export interface SlotsResponse {
  slots: ShelterSlot[];
}

/** CU-19 · body of POST /api/shelter/slots (ISO instants). */
export interface SlotRequest {
  startsAt: string;
  endsAt: string;
  capacity: number;
}

export interface SlotResponse {
  slot: ShelterSlot;
}

/** CU-50 · body of POST /api/shelter/slots/recurring (Madrid dates and times). */
export interface RecurringSlotsRequest {
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** HH:MM */
  startTime: string;
  endTime: string;
  capacity: number;
}

export interface RecurringSlotsResponse {
  /** The slots created. */
  slots: ShelterSlot[];
  /** RN-192: dates not generated because they overlap an existing slot (ISO instants). */
  skipped: { startsAt: string; endsAt: string }[];
}

/** RN-194 · a slot the adopter can choose for a pet (ISO instants). */
export interface AvailableSlot {
  id: number;
  startsAt: string;
  endsAt: string;
  freePlaces: number;
}

/** RN-194 · GET /api/adopter/pets/:id/slots */
export interface AvailableSlotsResponse {
  slots: AvailableSlot[];
}

/** CU-23 · body of POST /api/adopter/visits */
export interface VisitRequest {
  petId: number;
  slotId: number;
}

/** CU-23 · the visit just requested. RN-193: it takes place at the shelter's address. */
export interface RequestedVisit {
  id: number;
  status: string;
  petId: number;
  petName: string;
  slotId: number;
  startsAt: string;
  endsAt: string;
  shelterName: string;
  shelterAddress: string;
}

export interface VisitRequestResponse {
  visit: RequestedVisit;
}

/** CU-24, CU-25 · body of POST /api/shelter/visits/:id/reject (RN-96: optional reason). */
export interface RejectVisitRequest {
  reason?: string;
}

/** CU-24, CU-25 · the visit after confirming, rejecting or cancelling it. */
export interface VisitStatusResponse {
  visit: { id: number; status: string };
}

export type VisitStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "VOIDED" | "COMPLETED" | "NO_SHOW";

/** CU-21 · a visit in the adopter's list (ISO instants). */
export interface AdopterVisit {
  id: number;
  status: VisitStatus;
  petId: number;
  petName: string;
  photoUrl: string | null;
  shelterId: number;
  shelterName: string;
  startsAt: string;
  endsAt: string;
  /** RN-96 */
  rejectionReason: string | null;
  /** RN-101 */
  cancelledBy: "ADOPTER" | "SHELTER" | null;
  /** RN-109 */
  voidReason: string | null;
  /** RN-97, RN-98: pending or confirmed, with enough notice left to cancel. */
  canCancel: boolean;
}

/** CU-21, RN-89 to RN-93 · the adopter's quota at a shelter. */
export interface ShelterQuota {
  shelterId: number;
  shelterName: string;
  used: number;
  limit: number;
  /** RN-90: months of the moving window. */
  windowMonths: number;
  /** When the soonest place frees up (ISO), or null if no visit counts. */
  nextPlaceAt: string | null;
  /** RN-89: a no-show there; no more visits at that shelter. */
  noShow: boolean;
}

/** CU-21 · GET /api/adopter/visits */
export interface AdopterVisitsResponse {
  visits: AdopterVisit[];
  quotas: ShelterQuota[];
}

/** CU-22 · a visit in the shelter's inbox (ISO instants). */
export interface InboxVisit {
  id: number;
  status: VisitStatus;
  petId: number;
  petName: string;
  adopterId: number;
  adopterName: string;
  startsAt: string;
  endsAt: string;
  /** RN-94: deadline to answer a pending request; null for confirmed visits. */
  respondBy: string | null;
}

/** CU-22 · GET /api/shelter/inbox */
export interface ShelterInboxResponse {
  pending: InboxVisit[];
  upcoming: InboxVisit[];
}

export interface ErrorResponse {
  /** Message for the user, in Spanish. */
  error: string;
  /** Invalid input fields and their messages, when the input format is wrong. */
  fields?: Record<string, string>;
}
