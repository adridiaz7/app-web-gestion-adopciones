-- =============================================================================
-- Demo data, minimal version (T-10). Runs after db/schema.sql: npm run db:reset.
-- The tests never use this file: they start from schema.sql and create their own data.
--
-- Demo accounts (all verified). Password of every account: Lagun-demo-2026
--   admin@lagun.test       administrator
--   protectora@lagun.test  shelter "Protectora Txiki", validated
--   adoptante@lagun.test   adopter "Ane Etxeberria"
--
-- The hash was generated with: node scripts/hash-password.ts "Lagun-demo-2026"
-- To change the password, generate a new hash and replace it below.
-- =============================================================================

BEGIN;

INSERT INTO "App_user" (email, password_hash, role, email_verified_at, terms_accepted_at)
SELECT email, '$argon2id$v=19$m=19456,t=2,p=1$MbyFPFJQLwNBv+G35ujGXA$VLOWtIsSo4xMxyvj2zrhnnlpIwsUXRgomZ4bynQeBOk', role, now(), now()
FROM (VALUES
  ('admin@lagun.test',      'ADMIN'),
  ('protectora@lagun.test', 'SHELTER'),
  ('adoptante@lagun.test',  'ADOPTER')
) AS demo (email, role);

INSERT INTO "Shelter" (user_id, name, cif, description, address, province_id, locality, phone,
                       contact_email, opening_hours, validation_status, validated_at)
SELECT id, 'Protectora Txiki', 'G20123456',
       'Protectora de perros y gatos en Donostia. Buscamos hogares responsables para nuestros animales.',
       'Calle del Puerto 3', 20, 'Donostia', '943123456',
       'hola@txiki.test', 'De lunes a sábado, de 10:00 a 14:00', 'VALIDATED', now()
FROM "App_user" WHERE email = 'protectora@lagun.test';

INSERT INTO "Adopter" (user_id, first_name, last_name, phone, birth_date, province_id, locality)
SELECT id, 'Ane', 'Etxeberria', '600123456', DATE '1995-04-12', 20, 'Donostia'
FROM "App_user" WHERE email = 'adoptante@lagun.test';

-- Four available pets of the shelter, without photos (they arrive with T-13 and T-42).
-- Birth dates are relative to today, so the ages stay right whenever the seed runs.
INSERT INTO "Pet" (shelter_id, breed_id, name, description, birth_date, sex, size, activity_level,
                   good_with_children, vaccinated, dewormed, sterilized, microchipped, special_needs)
SELECT s.user_id, b.id, p.name, p.description, (current_date - p.age)::date, p.sex, p.size, p.activity,
       p.children, true, true, p.sterilized, true, p.special_needs
FROM (VALUES
  ('Perro', 'Mestizo / Desconocida', 'Txuri',
   'Perra mestiza muy cariñosa. Le encanta pasear por la playa y se lleva bien con todo el mundo.',
   interval '3 years', 'FEMALE', 'MEDIUM', 'MEDIUM', 'YES', true, NULL),
  ('Perro', 'Galgo Español', 'Beltza',
   'Galgo tranquilo y algo tímido al principio. En casa es un sofá con patas.',
   interval '5 years', 'MALE', 'LARGE', 'LOW', 'UNKNOWN', true, NULL),
  ('Gato', 'Mestizo / Desconocida', 'Mitxi',
   'Gata joven, curiosa y juguetona. Ideal para un hogar con tiempo para jugar.',
   interval '10 months', 'FEMALE', 'SMALL', 'HIGH', 'YES', false, NULL),
  ('Gato', 'Azul Ruso', 'Urdin',
   'Gato adulto, sereno y muy limpio. Prefiere un hogar tranquilo sin niños pequeños.',
   interval '7 years', 'MALE', 'SMALL', 'LOW', 'NO', true, 'Dieta renal: pienso especial.')
) AS p (species, breed, name, description, age, sex, size, activity, children, sterilized, special_needs)
JOIN "Species" sp ON sp.name = p.species
JOIN "Breed" b ON b.species_id = sp.id AND b.name = p.breed
CROSS JOIN (SELECT user_id FROM "Shelter" WHERE cif = 'G20123456') s;

COMMIT;
