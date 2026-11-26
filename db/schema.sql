-- =============================================================================
-- Lagun · Database schema (PostgreSQL 18)
--
-- Creates every table, constraint and index from scratch, plus the catalogue
-- data the app needs to work (provinces, species and breeds).
-- Demo data lives in seed.sql, which runs after this file.
--
-- WARNING: running this file DROPS ALL TABLES AND DATA and recreates them.
--
-- Design: docs/modelo-entidad-relacion.md
-- Naming: main tables are capitalised and always double-quoted ("Pet");
--         many-to-many join tables are lowercase and end in _rel.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Clean slate
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS
  "Audit_log",
  "Suspension",
  "Adopter_note",
  "Block",
  "Notification",
  "Incident",
  "Message",
  "Conversation",
  "Adoption",
  "Visit",
  "Visit_slot",
  adopter_pet_rel,
  pet_species_rel,
  "Pet_photo",
  "Pet",
  adopter_preferences_breed_rel,
  adopter_preferences_species_rel,
  "Adopter_preferences",
  "Email_token",
  "Session",
  "Shelter",
  "Adopter",
  "App_user",
  "Breed",
  "Species",
  "Province"
CASCADE;

-- -----------------------------------------------------------------------------
-- 1. Catalogues
-- -----------------------------------------------------------------------------

CREATE TABLE "Province" (
  id   smallint PRIMARY KEY,                       -- INE code (1-52)
  name text     NOT NULL,
  CONSTRAINT province_name_uq UNIQUE (name)
);

CREATE TABLE "Species" (
  id   smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text     NOT NULL,
  CONSTRAINT species_name_uq UNIQUE (name)
);

CREATE TABLE "Breed" (
  id         int      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  species_id smallint NOT NULL REFERENCES "Species" (id),
  name       text     NOT NULL,
  CONSTRAINT breed_species_name_uq UNIQUE (species_id, name)
);

-- -----------------------------------------------------------------------------
-- 2. Users and access
-- -----------------------------------------------------------------------------

CREATE TABLE "App_user" (
  id                         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                      text        NOT NULL CHECK (btrim(email) <> ''),
  password_hash              text        NOT NULL,
  role                       text        NOT NULL CHECK (role IN ('ADOPTER', 'SHELTER', 'ADMIN')),
  email_verified_at          timestamptz,
  terms_accepted_at          timestamptz NOT NULL,
  existing_account_notice_at timestamptz,
  deleted_at                 timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_user_email_uq ON "App_user" (lower(email));

CREATE TABLE "Adopter" (
  user_id                bigint      PRIMARY KEY REFERENCES "App_user" (id),
  first_name             text        NOT NULL,
  last_name              text        NOT NULL,
  phone                  text        NOT NULL,
  birth_date             date        NOT NULL,
  province_id            smallint    NOT NULL REFERENCES "Province" (id),
  locality               text        NOT NULL,
  -- Household data: optional at sign-up, required to apply for an adoption (RN-27)
  housing_type           text        CHECK (housing_type IN ('APARTMENT', 'HOUSE', 'OTHER')),
  has_outdoor_space      boolean,
  housing_tenure         text        CHECK (housing_tenure IN ('OWNED', 'RENTED', 'RENT_TO_OWN')),
  household_members      smallint    CHECK (household_members >= 1),
  has_children           boolean,
  has_other_pets         boolean,
  other_pets_description text,
  has_pet_experience     boolean,
  hours_alone_per_day    smallint    CHECK (hours_alone_per_day BETWEEN 0 AND 24),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Shelter" (
  user_id           bigint      PRIMARY KEY REFERENCES "App_user" (id),
  name              text        NOT NULL,
  cif               text        NOT NULL,
  description       text,
  logo_path         text,
  address           text        NOT NULL,
  province_id       smallint    NOT NULL REFERENCES "Province" (id),
  locality          text        NOT NULL,
  phone             text        NOT NULL,
  contact_email     text,
  website           text,
  opening_hours     text,
  validation_status text        NOT NULL DEFAULT 'PENDING'
                                CHECK (validation_status IN ('PENDING', 'VALIDATED', 'REJECTED')),
  validation_reason text,
  validated_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shelter_cif_uq UNIQUE (cif),
  CONSTRAINT shelter_rejection_needs_reason
    CHECK (validation_status <> 'REJECTED' OR validation_reason IS NOT NULL)
);

CREATE TABLE "Session" (
  token_hash text        PRIMARY KEY,               -- SHA-256 of the cookie token
  user_id    bigint      NOT NULL REFERENCES "App_user" (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX session_user_idx ON "Session" (user_id);

CREATE TABLE "Email_token" (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES "App_user" (id) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('VERIFY_EMAIL', 'RESET_PASSWORD', 'CHANGE_EMAIL')),
  token_hash text        NOT NULL,
  new_email  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  CONSTRAINT email_token_hash_uq UNIQUE (token_hash),
  CONSTRAINT email_token_new_email_only_for_change
    CHECK ((purpose = 'CHANGE_EMAIL') = (new_email IS NOT NULL))
);

CREATE INDEX email_token_user_purpose_idx ON "Email_token" (user_id, purpose, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Preferences (an empty list or NULL means "no preference")
-- -----------------------------------------------------------------------------

CREATE TABLE "Adopter_preferences" (
  adopter_id               bigint      PRIMARY KEY REFERENCES "Adopter" (user_id),
  sizes                    text[]      NOT NULL DEFAULT '{}'
                                       CHECK (sizes <@ ARRAY['SMALL', 'MEDIUM', 'LARGE']::text[]),
  sexes                    text[]      NOT NULL DEFAULT '{}'
                                       CHECK (sexes <@ ARRAY['MALE', 'FEMALE']::text[]),
  activity_levels          text[]      NOT NULL DEFAULT '{}'
                                       CHECK (activity_levels <@ ARRAY['LOW', 'MEDIUM', 'HIGH']::text[]),
  min_age_months           smallint    CHECK (min_age_months >= 0),
  max_age_months           smallint    CHECK (max_age_months >= 0),
  needs_good_with_children boolean     NOT NULL DEFAULT false,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preferences_age_range
    CHECK (min_age_months IS NULL OR max_age_months IS NULL OR min_age_months <= max_age_months)
);

CREATE TABLE adopter_preferences_species_rel (
  adopter_id     bigint   NOT NULL REFERENCES "Adopter_preferences" (adopter_id) ON DELETE CASCADE,
  species_id     smallint NOT NULL REFERENCES "Species" (id),
  is_wanted      boolean  NOT NULL,                 -- interested in this species
  must_get_along boolean  NOT NULL,                 -- the pet must get along with this species (RN-37)
  PRIMARY KEY (adopter_id, species_id),
  CONSTRAINT preferences_species_not_empty CHECK (is_wanted OR must_get_along)
);

CREATE TABLE adopter_preferences_breed_rel (
  adopter_id bigint NOT NULL REFERENCES "Adopter_preferences" (adopter_id) ON DELETE CASCADE,
  breed_id   int    NOT NULL REFERENCES "Breed" (id),
  PRIMARY KEY (adopter_id, breed_id)
);

-- -----------------------------------------------------------------------------
-- 4. Pets
-- -----------------------------------------------------------------------------

CREATE TABLE "Pet" (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shelter_id         bigint      NOT NULL REFERENCES "Shelter" (user_id),
  breed_id           int         NOT NULL REFERENCES "Breed" (id),
  name               text        NOT NULL,
  description        text        NOT NULL,
  birth_date         date        NOT NULL,          -- approximate (RN-43)
  sex                text        NOT NULL CHECK (sex IN ('MALE', 'FEMALE')),
  size               text        NOT NULL CHECK (size IN ('SMALL', 'MEDIUM', 'LARGE')),
  activity_level     text        NOT NULL CHECK (activity_level IN ('LOW', 'MEDIUM', 'HIGH')),
  good_with_children text        NOT NULL DEFAULT 'UNKNOWN' CHECK (good_with_children IN ('YES', 'NO', 'UNKNOWN')),
  vaccinated         boolean     NOT NULL,
  dewormed           boolean     NOT NULL,
  sterilized         boolean     NOT NULL,
  microchipped       boolean     NOT NULL,
  special_needs      text,
  status             text        NOT NULL DEFAULT 'AVAILABLE'
                                 CHECK (status IN ('AVAILABLE', 'RESERVED', 'ADOPTED', 'UNLISTED')),
  unlist_reason      text        CHECK (unlist_reason IN ('DECEASED', 'TRANSFERRED', 'TREATMENT', 'FOSTER',
                                                          'ERROR', 'OTHER', 'REMOVED_BY_ADMIN', 'ACCOUNT_DELETED')),
  unlisted_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pet_id_shelter_uq UNIQUE (id, shelter_id),   -- target of Visit's composite FK
  CONSTRAINT pet_unlist_reason_iff_unlisted CHECK ((status = 'UNLISTED') = (unlist_reason IS NOT NULL)),
  CONSTRAINT pet_unlisted_at_iff_unlisted   CHECK ((status = 'UNLISTED') = (unlisted_at IS NOT NULL))
);

CREATE INDEX pet_shelter_idx ON "Pet" (shelter_id);
CREATE INDEX pet_available_idx ON "Pet" (created_at DESC) WHERE status = 'AVAILABLE';

CREATE TABLE "Pet_photo" (
  id       bigint   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pet_id   bigint   NOT NULL REFERENCES "Pet" (id),
  path     text     NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 6),   -- 1 = main photo; max 6 (RN-50)
  CONSTRAINT pet_photo_position_uq UNIQUE (pet_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE pet_species_rel (
  pet_id     bigint   NOT NULL REFERENCES "Pet" (id),
  species_id smallint NOT NULL REFERENCES "Species" (id),
  gets_along boolean  NOT NULL,                     -- no row = unknown (RN-46)
  PRIMARY KEY (pet_id, species_id)
);

CREATE TABLE adopter_pet_rel (
  adopter_id bigint      NOT NULL REFERENCES "Adopter" (user_id),
  pet_id     bigint      NOT NULL REFERENCES "Pet" (id),
  type       text        NOT NULL CHECK (type IN ('FAVORITE', 'DISCARDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (adopter_id, pet_id)                  -- one rating per adopter and pet (RN-74)
);

CREATE INDEX adopter_pet_rel_pet_idx ON adopter_pet_rel (pet_id);

-- -----------------------------------------------------------------------------
-- 5. Visit slots and visits
-- -----------------------------------------------------------------------------

CREATE TABLE "Visit_slot" (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shelter_id   bigint      NOT NULL REFERENCES "Shelter" (user_id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  capacity     smallint    NOT NULL CHECK (capacity >= 1),
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_slot_id_shelter_uq UNIQUE (id, shelter_id),   -- target of Visit's composite FK
  CONSTRAINT visit_slot_ends_after_start CHECK (ends_at > starts_at)
);

CREATE INDEX visit_slot_shelter_starts_idx ON "Visit_slot" (shelter_id, starts_at) WHERE cancelled_at IS NULL;

CREATE TABLE "Visit" (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adopter_id           bigint      NOT NULL REFERENCES "Adopter" (user_id),
  shelter_id           bigint      NOT NULL REFERENCES "Shelter" (user_id),
  pet_id               bigint      NOT NULL,
  slot_id              bigint      NOT NULL,
  status               text        NOT NULL DEFAULT 'PENDING'
                                   CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED',
                                                     'EXPIRED', 'VOIDED', 'COMPLETED', 'NO_SHOW')),
  replaces_visit_id    bigint      REFERENCES "Visit" (id),
  responded_at         timestamptz,
  rejection_reason     text,
  cancelled_by         text        CHECK (cancelled_by IN ('ADOPTER', 'SHELTER')),
  cancelled_at         timestamptz,
  void_reason          text        CHECK (void_reason IN ('PET_RESERVED', 'PET_UNLISTED', 'ADOPTER_BLOCKED',
                                                        'NO_SHOW', 'SLOT_CANCELLED', 'ADOPTER_SUSPENDED',
                                                        'ACCOUNT_DELETED')),
  voided_at            timestamptz,
  attendance_marked_by text        CHECK (attendance_marked_by IN ('SHELTER', 'SYSTEM', 'ADMIN')),
  attendance_marked_at timestamptz,
  reminder_sent_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Pet and slot always belong to the visit's shelter (RN-83)
  CONSTRAINT visit_pet_same_shelter_fk  FOREIGN KEY (pet_id, shelter_id)  REFERENCES "Pet" (id, shelter_id),
  CONSTRAINT visit_slot_same_shelter_fk FOREIGN KEY (slot_id, shelter_id) REFERENCES "Visit_slot" (id, shelter_id),
  CONSTRAINT visit_not_replacing_itself CHECK (replaces_visit_id <> id),
  CONSTRAINT visit_cancelled_by_iff_cancelled   CHECK ((status = 'CANCELLED') = (cancelled_by IS NOT NULL)),
  CONSTRAINT visit_cancelled_at_iff_cancelled   CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT visit_void_reason_iff_voided       CHECK ((status = 'VOIDED') = (void_reason IS NOT NULL)),
  CONSTRAINT visit_voided_at_iff_voided         CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CONSTRAINT visit_attendance_iff_attended
    CHECK ((status IN ('COMPLETED', 'NO_SHOW')) = (attendance_marked_by IS NOT NULL)),
  CONSTRAINT visit_attendance_at_iff_marked
    CHECK ((attendance_marked_by IS NULL) = (attendance_marked_at IS NULL))
);

-- One active visit per pet and slot (RN-81)
CREATE UNIQUE INDEX visit_active_pet_slot_uq ON "Visit" (pet_id, slot_id) WHERE status IN ('PENDING', 'CONFIRMED');
-- Occupied places per slot (RN-82)
CREATE INDEX visit_active_slot_idx ON "Visit" (slot_id) WHERE status IN ('PENDING', 'CONFIRMED');
-- Quota and no-shows per adopter and shelter (RN-89, RN-90)
CREATE INDEX visit_adopter_shelter_idx ON "Visit" (adopter_id, shelter_id, status);
-- Scheduled job: expire unanswered requests (RN-95)
CREATE INDEX visit_pending_created_idx ON "Visit" (created_at) WHERE status = 'PENDING';

-- -----------------------------------------------------------------------------
-- 6. Adoptions
-- -----------------------------------------------------------------------------

CREATE TABLE "Adoption" (
  id                        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adopter_id                bigint      NOT NULL REFERENCES "Adopter" (user_id),
  pet_id                    bigint      NOT NULL REFERENCES "Pet" (id),
  visit_id                  bigint      NOT NULL REFERENCES "Visit" (id),   -- completed visit that enables it (RN-114)
  questionnaire_answers     jsonb       NOT NULL CHECK (jsonb_typeof(questionnaire_answers) = 'object'),
  status                    text        NOT NULL DEFAULT 'PENDING'
                                        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'NOT_SELECTED',
                                                          'CANCELLED', 'VOIDED', 'COMPLETED', 'RETURNED')),
  decided_at                timestamptz,
  rejection_reason          text,
  cancelled_by              text        CHECK (cancelled_by IN ('ADOPTER', 'SHELTER', 'SYSTEM')),
  cancellation_reason       text,
  cancelled_at              timestamptz,
  void_reason               text        CHECK (void_reason IN ('PET_UNLISTED', 'ADOPTER_BLOCKED', 'NO_SHOW',
                                                               'ADOPTER_SUSPENDED', 'ACCOUNT_DELETED')),
  voided_at                 timestamptz,
  delivered_at              timestamptz,
  returned_at               timestamptz,
  return_reason             text,
  last_pending_reminder_at  timestamptz,
  last_delivery_reminder_at timestamptz,
  admin_alerted_at          timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adoption_rejection_needs_reason   CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CONSTRAINT adoption_cancelled_by_iff_cancelled CHECK ((status = 'CANCELLED') = (cancelled_by IS NOT NULL)),
  CONSTRAINT adoption_cancelled_at_iff_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT adoption_void_reason_iff_voided   CHECK ((status = 'VOIDED') = (void_reason IS NOT NULL)),
  CONSTRAINT adoption_voided_at_iff_voided     CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CONSTRAINT adoption_delivered_when_completed CHECK (status NOT IN ('COMPLETED', 'RETURNED') OR delivered_at IS NOT NULL),
  CONSTRAINT adoption_returned_iff_returned    CHECK ((status = 'RETURNED') = (returned_at IS NOT NULL)),
  CONSTRAINT adoption_return_needs_reason      CHECK (status <> 'RETURNED' OR return_reason IS NOT NULL)
);

-- One open application per adopter and pet (RN-119)
CREATE UNIQUE INDEX adoption_open_adopter_pet_uq ON "Adoption" (adopter_id, pet_id) WHERE status IN ('PENDING', 'APPROVED');
-- Only one approved or completed adoption per pet (RN-125)
CREATE UNIQUE INDEX adoption_active_pet_uq ON "Adoption" (pet_id) WHERE status IN ('APPROVED', 'COMPLETED');
CREATE INDEX adoption_pet_status_idx ON "Adoption" (pet_id, status);

-- -----------------------------------------------------------------------------
-- 7. Chat
-- -----------------------------------------------------------------------------

CREATE TABLE "Conversation" (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adopter_id bigint      NOT NULL REFERENCES "Adopter" (user_id),
  shelter_id bigint      NOT NULL REFERENCES "Shelter" (user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_pair_uq UNIQUE (adopter_id, shelter_id)   -- one per pair (RN-133)
);

CREATE INDEX conversation_shelter_idx ON "Conversation" (shelter_id);

CREATE TABLE "Message" (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint      NOT NULL REFERENCES "Conversation" (id),
  sender_id       bigint      NOT NULL REFERENCES "App_user" (id),
  body            text,
  attachment_path text,
  attachment_type text        CHECK (attachment_type IN ('IMAGE')),   -- add 'VIDEO' if videos are accepted
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- body IS NOT NULL is needed: btrim(NULL) <> '' is NULL, and a NULL CHECK counts as passed
  CONSTRAINT message_not_empty CHECK ((body IS NOT NULL AND btrim(body) <> '') OR attachment_path IS NOT NULL),
  CONSTRAINT message_attachment_complete CHECK ((attachment_path IS NULL) = (attachment_type IS NULL))
);

CREATE INDEX message_conversation_idx ON "Message" (conversation_id, id);

-- -----------------------------------------------------------------------------
-- 8. Incidents and notifications
-- -----------------------------------------------------------------------------

CREATE TABLE "Incident" (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id bigint      NOT NULL REFERENCES "App_user" (id),
  reported_id bigint      NOT NULL REFERENCES "App_user" (id),
  reason      text        NOT NULL CHECK (reason IN ('WRONG_ATTENDANCE', 'INAPPROPRIATE_BEHAVIOUR', 'FALSE_INFORMATION',
                                                     'INAPPROPRIATE_CONTENT', 'UNFAIR_BLOCK', 'OTHER')),
  description text        NOT NULL CHECK (btrim(description) <> ''),
  visit_id    bigint      REFERENCES "Visit" (id),
  adoption_id bigint      REFERENCES "Adoption" (id),
  status      text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  resolution  text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_not_self CHECK (reporter_id <> reported_id),
  CONSTRAINT incident_single_link CHECK (num_nonnulls(visit_id, adoption_id) <= 1),
  CONSTRAINT incident_closed_needs_resolution
    CHECK ((status IN ('RESOLVED', 'DISMISSED')) = (resolution IS NOT NULL AND resolved_at IS NOT NULL))
);

CREATE INDEX incident_status_idx ON "Incident" (status, created_at);

CREATE TABLE "Notification" (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES "App_user" (id),
  type        text        NOT NULL,                  -- open list (RN-144)
  title       text        NOT NULL,
  body        text        NOT NULL,
  visit_id    bigint      REFERENCES "Visit" (id),
  adoption_id bigint      REFERENCES "Adoption" (id),
  pet_id      bigint      REFERENCES "Pet" (id),
  incident_id bigint      REFERENCES "Incident" (id),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_single_link
    CHECK (num_nonnulls(visit_id, adoption_id, pet_id, incident_id) <= 1)   -- RN-142
);

CREATE INDEX notification_user_idx ON "Notification" (user_id, created_at DESC);
CREATE INDEX notification_unread_idx ON "Notification" (user_id) WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- 9. Blocks, notes and suspensions
-- -----------------------------------------------------------------------------

CREATE TABLE "Block" (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shelter_id bigint      NOT NULL REFERENCES "Shelter" (user_id),
  adopter_id bigint      NOT NULL REFERENCES "Adopter" (user_id),
  reason     text        NOT NULL CHECK (reason IN ('INAPPROPRIATE_BEHAVIOUR', 'FALSE_INFORMATION', 'BREACHES', 'OTHER')),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,                            -- NULL = permanent (RN-201)
  lifted_at  timestamptz,
  lifted_by  text        CHECK (lifted_by IN ('SHELTER', 'SYSTEM')),
  CONSTRAINT block_ends_after_start CHECK (ends_at IS NULL OR ends_at > created_at),
  CONSTRAINT block_lifted_complete  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);

-- One active block per pair (RN-151)
CREATE UNIQUE INDEX block_active_pair_uq ON "Block" (shelter_id, adopter_id) WHERE lifted_at IS NULL;
CREATE INDEX block_adopter_idx ON "Block" (adopter_id);
-- Scheduled job: lift expired temporary blocks (RN-202)
CREATE INDEX block_temporary_active_idx ON "Block" (ends_at) WHERE lifted_at IS NULL AND ends_at IS NOT NULL;

CREATE TABLE "Adopter_note" (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shelter_id bigint      NOT NULL REFERENCES "Shelter" (user_id),
  adopter_id bigint      NOT NULL REFERENCES "Adopter" (user_id),
  body       text        NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX adopter_note_pair_idx ON "Adopter_note" (shelter_id, adopter_id);

CREATE TABLE "Suspension" (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES "App_user" (id),
  reason     text        NOT NULL CHECK (reason IN ('INAPPROPRIATE_BEHAVIOUR', 'FALSE_INFORMATION', 'INAPPROPRIATE_CONTENT',
                                                    'FRAUD', 'REPEATED_INCIDENTS', 'OTHER')),
  detail     text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  CONSTRAINT suspension_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- One active suspension per user (RN-156)
CREATE UNIQUE INDEX suspension_active_user_uq ON "Suspension" (user_id) WHERE ended_at IS NULL;

-- -----------------------------------------------------------------------------
-- 10. Audit log (insert-only, RN-208 to RN-210)
-- -----------------------------------------------------------------------------

CREATE TABLE "Audit_log" (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id bigint      REFERENCES "App_user" (id),   -- NULL = system or unidentified user
  action        text        NOT NULL,
  entity_type   text,
  entity_id     bigint,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON "Audit_log" (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON "Audit_log" (actor_user_id, created_at);

-- =============================================================================
-- 11. Catalogue data
-- =============================================================================

INSERT INTO "Province" (id, name) VALUES
  (1, 'Araba/Álava'),           (2, 'Albacete'),              (3, 'Alicante/Alacant'),
  (4, 'Almería'),               (5, 'Ávila'),                 (6, 'Badajoz'),
  (7, 'Illes Balears'),         (8, 'Barcelona'),             (9, 'Burgos'),
  (10, 'Cáceres'),              (11, 'Cádiz'),                (12, 'Castellón/Castelló'),
  (13, 'Ciudad Real'),          (14, 'Córdoba'),              (15, 'A Coruña'),
  (16, 'Cuenca'),               (17, 'Girona'),               (18, 'Granada'),
  (19, 'Guadalajara'),          (20, 'Gipuzkoa'),             (21, 'Huelva'),
  (22, 'Huesca'),               (23, 'Jaén'),                 (24, 'León'),
  (25, 'Lleida'),               (26, 'La Rioja'),             (27, 'Lugo'),
  (28, 'Madrid'),               (29, 'Málaga'),               (30, 'Murcia'),
  (31, 'Navarra'),              (32, 'Ourense'),              (33, 'Asturias'),
  (34, 'Palencia'),             (35, 'Las Palmas'),           (36, 'Pontevedra'),
  (37, 'Salamanca'),            (38, 'Santa Cruz de Tenerife'), (39, 'Cantabria'),
  (40, 'Segovia'),              (41, 'Sevilla'),              (42, 'Soria'),
  (43, 'Tarragona'),            (44, 'Teruel'),               (45, 'Toledo'),
  (46, 'Valencia/València'),    (47, 'Valladolid'),           (48, 'Bizkaia'),
  (49, 'Zamora'),               (50, 'Zaragoza'),             (51, 'Ceuta'),
  (52, 'Melilla');

INSERT INTO "Species" (name) VALUES ('Perro'), ('Gato');

INSERT INTO "Breed" (species_id, name)
SELECT s.id, b.name
FROM "Species" s
JOIN (VALUES
  ('Perro', 'Mestizo / Desconocida'),
  ('Perro', 'American Staffordshire Terrier'),
  ('Perro', 'Beagle'),
  ('Perro', 'Bodeguero Andaluz'),
  ('Perro', 'Border Collie'),
  ('Perro', 'Boxer'),
  ('Perro', 'Bulldog Francés'),
  ('Perro', 'Caniche'),
  ('Perro', 'Chihuahua'),
  ('Perro', 'Cocker Spaniel Inglés'),
  ('Perro', 'Epagneul Bretón'),
  ('Perro', 'Galgo Español'),
  ('Perro', 'Golden Retriever'),
  ('Perro', 'Husky Siberiano'),
  ('Perro', 'Jack Russell Terrier'),
  ('Perro', 'Labrador Retriever'),
  ('Perro', 'Mastín Español'),
  ('Perro', 'Pastor Alemán'),
  ('Perro', 'Pastor Belga Malinois'),
  ('Perro', 'Podenco Andaluz'),
  ('Perro', 'Podenco Ibicenco'),
  ('Perro', 'Setter Inglés'),
  ('Perro', 'Shih Tzu'),
  ('Perro', 'Teckel'),
  ('Perro', 'Yorkshire Terrier'),
  ('Gato', 'Mestizo / Desconocida'),
  ('Gato', 'Angora Turco'),
  ('Gato', 'Azul Ruso'),
  ('Gato', 'Bengalí'),
  ('Gato', 'Bosque de Noruega'),
  ('Gato', 'British Shorthair'),
  ('Gato', 'Común Europeo'),
  ('Gato', 'Maine Coon'),
  ('Gato', 'Persa'),
  ('Gato', 'Ragdoll'),
  ('Gato', 'Siamés'),
  ('Gato', 'Sphynx')
) AS b (species_name, name) ON b.species_name = s.name;

COMMIT;
