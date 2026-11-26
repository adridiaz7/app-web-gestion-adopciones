-- =============================================================================
-- Demo data: minimal version (T-10) plus the visual demo with photos (T-46).
-- Runs after db/schema.sql: npm run db:reset.
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

-- -----------------------------------------------------------------------------
-- Visual demo (T-46): three more validated shelters with logo and pets with photos.
-- The images live in db/seed-photos/ and npm run db:reset copies them to
-- uploads/seed/, keeping their folders; the rows below point there.
--
-- More demo accounts (verified, same password: Lagun-demo-2026):
--   cansolo@lagun.test         shelter "Can Solo", validated
--   nakama@lagun.test          shelter "Nakama", validated
--   parqueamigazo@lagun.test   shelter "Parque Amigazo", validated
-- -----------------------------------------------------------------------------

INSERT INTO "App_user" (email, password_hash, role, email_verified_at, terms_accepted_at)
SELECT email, '$argon2id$v=19$m=19456,t=2,p=1$MbyFPFJQLwNBv+G35ujGXA$VLOWtIsSo4xMxyvj2zrhnnlpIwsUXRgomZ4bynQeBOk', 'SHELTER', now(), now()
FROM (VALUES ('cansolo@lagun.test'), ('nakama@lagun.test'), ('parqueamigazo@lagun.test')) AS demo (email);

INSERT INTO "Shelter" (user_id, name, cif, description, logo_path, address, province_id, locality, phone,
                       contact_email, website, opening_hours, validation_status, validated_at)
SELECT u.id, s.name, s.cif, s.description, s.logo, s.address, s.province, s.locality, s.phone,
       s.contact, s.website, s.hours, 'VALIDATED', now()
FROM (VALUES
  ('cansolo@lagun.test', 'Can Solo', 'G48123457',
   'Refugio de perros en Bilbao. Ningún perro debería estar solo: cuidamos de ellos hasta encontrarles familia.',
   '/uploads/seed/logos/can-solo.png', 'Calle Zabalbide 21', 48, 'Bilbao', '944123457',
   'hola@cansolo.test', 'https://cansolo.test', 'De martes a domingo, de 10:00 a 13:30'),
  ('nakama@lagun.test', 'Nakama', 'G31123458',
   'Asociación de Pamplona dedicada a perros y gatos abandonados. Nakama significa "compañero": eso buscamos para ellos.',
   '/uploads/seed/logos/nakama.png', 'Avenida de Zaragoza 40', 31, 'Pamplona', '948123458',
   'contacto@nakama.test', NULL, 'De lunes a viernes, de 17:00 a 20:00; sábados, de 10:00 a 14:00'),
  ('parqueamigazo@lagun.test', 'Parque Amigazo', 'G01123459',
   'Protectora con un gran parque en Vitoria-Gasteiz donde los animales juegan al aire libre mientras esperan un hogar.',
   '/uploads/seed/logos/parque-amigazo.png', 'Camino de Olarizu 5', 1, 'Vitoria-Gasteiz', '945123459',
   'info@parqueamigazo.test', 'https://parqueamigazo.test', 'Fines de semana, de 11:00 a 14:00')
) AS s (email, name, cif, description, logo, address, province, locality, phone, contact, website, hours)
JOIN "App_user" u ON u.email = s.email;

-- One pet per folder of db/seed-photos/mascotas/ (especie-nombre), chosen by looking at the photos.
INSERT INTO "Pet" (shelter_id, breed_id, name, description, birth_date, sex, size, activity_level,
                   good_with_children, vaccinated, dewormed, sterilized, microchipped, special_needs)
SELECT s.user_id, b.id, p.name, p.description, (current_date - p.age)::date, p.sex, p.size, p.activity,
       p.children, true, true, p.sterilized, true, p.special_needs
FROM (VALUES
  ('G48123457', 'Perro', 'Mestizo / Desconocida', 'Pistacho',
   'Mestizo negro y fuego, listo y muy juguetón. Aprende rápido y le encantan las pelotas.',
   interval '2 years', 'MALE', 'SMALL', 'HIGH', 'YES', true, NULL),
  ('G48123457', 'Perro', 'Mestizo / Desconocida', 'Rocky',
   'Perro grande y bonachón que ya peina canas. Pasea tranquilo y solo pide un sofá y cariño.',
   interval '8 years', 'MALE', 'LARGE', 'LOW', 'YES', true, 'Artrosis leve: paseos cortos y suplemento articular.'),
  ('G48123457', 'Perro', 'Mestizo / Desconocida', 'Shiro',
   'Cachorro blanco algo tímido al principio. En cuanto coge confianza, no se separa de ti.',
   interval '8 months', 'MALE', 'MEDIUM', 'HIGH', 'UNKNOWN', false, NULL),
  ('G31123458', 'Gato', 'Común Europeo', 'Diana',
   'Gata negra elegante e independiente. Le gusta tomar el sol y dormir cerca de las personas.',
   interval '2 years', 'FEMALE', 'SMALL', 'MEDIUM', 'YES', true, NULL),
  ('G31123458', 'Gato', 'Común Europeo', 'Paco',
   'Gato blanco tranquilo y observador. Ideal para un hogar sereno donde pueda vigilar desde la ventana.',
   interval '4 years', 'MALE', 'SMALL', 'LOW', 'NO', true, NULL),
  ('G31123458', 'Perro', 'Mestizo / Desconocida', 'Titán',
   'Pequeño de tamaño, gigante de carácter. Una bola de pelo blanco siempre contenta de salir al parque.',
   interval '3 years', 'MALE', 'SMALL', 'MEDIUM', 'YES', true, 'Necesita cepillado frecuente.'),
  ('G01123459', 'Gato', 'Común Europeo', 'Paprika',
   'Gata atigrada naranja, curiosa y parlanchina. Siempre quiere saber qué estás haciendo.',
   interval '1 year', 'FEMALE', 'SMALL', 'HIGH', 'YES', true, NULL),
  ('G01123459', 'Perro', 'Mestizo / Desconocida', 'Torpedo',
   'Mestizo tricolor noble y obediente. Corre como un torpedo en el parque y en casa es muy tranquilo.',
   interval '6 years', 'MALE', 'MEDIUM', 'MEDIUM', 'YES', true, NULL)
) AS p (cif, species, breed, name, description, age, sex, size, activity, children, sterilized, special_needs)
JOIN "Shelter" s ON s.cif = p.cif
JOIN "Species" sp ON sp.name = p.species
JOIN "Breed" b ON b.species_id = sp.id AND b.name = p.breed;

-- Photos in the order of their file names: 1.jpg is the main one (RN-51).
INSERT INTO "Pet_photo" (pet_id, path, position)
SELECT pet.id, ph.path, ph.position
FROM (VALUES
  ('Diana',    '/uploads/seed/mascotas/gato-diana/1.jpg', 1),
  ('Diana',    '/uploads/seed/mascotas/gato-diana/2.jpg', 2),
  ('Paco',     '/uploads/seed/mascotas/gato-paco/1.jpg', 1),
  ('Paco',     '/uploads/seed/mascotas/gato-paco/2.jpg', 2),
  ('Paco',     '/uploads/seed/mascotas/gato-paco/3.jpg', 3),
  ('Paprika',  '/uploads/seed/mascotas/gato-paprika/1.jpg', 1),
  ('Paprika',  '/uploads/seed/mascotas/gato-paprika/2.jpg', 2),
  ('Paprika',  '/uploads/seed/mascotas/gato-paprika/3.jpg', 3),
  ('Pistacho', '/uploads/seed/mascotas/perro-pistacho/1.jpg', 1),
  ('Pistacho', '/uploads/seed/mascotas/perro-pistacho/2.jpg', 2),
  ('Rocky',    '/uploads/seed/mascotas/perro-rocky/1.jpg', 1),
  ('Rocky',    '/uploads/seed/mascotas/perro-rocky/2.jpg', 2),
  ('Rocky',    '/uploads/seed/mascotas/perro-rocky/3.jpg', 3),
  ('Shiro',    '/uploads/seed/mascotas/perro-shiro/1.jpg', 1),
  ('Shiro',    '/uploads/seed/mascotas/perro-shiro/2.jpg', 2),
  ('Shiro',    '/uploads/seed/mascotas/perro-shiro/3.jpg', 3),
  ('Shiro',    '/uploads/seed/mascotas/perro-shiro/4.jpg', 4),
  ('Titán',    '/uploads/seed/mascotas/perro-titan/1.jpg', 1),
  ('Titán',    '/uploads/seed/mascotas/perro-titan/2.jpg', 2),
  ('Torpedo',  '/uploads/seed/mascotas/perro-torpedo/1.jpg', 1),
  ('Torpedo',  '/uploads/seed/mascotas/perro-torpedo/2.jpg', 2),
  ('Torpedo',  '/uploads/seed/mascotas/perro-torpedo/3.jpg', 3),
  ('Torpedo',  '/uploads/seed/mascotas/perro-torpedo/4.jpg', 4),
  ('Torpedo',  '/uploads/seed/mascotas/perro-torpedo/5.jpg', 5)
) AS ph (pet_name, path, position)
JOIN "Pet" pet ON pet.name = ph.pet_name
JOIN "Shelter" s ON s.user_id = pet.shelter_id AND s.cif IN ('G48123457', 'G31123458', 'G01123459');

-- -----------------------------------------------------------------------------
-- History for the demo (T-42): household data, preferences, favourites, visit
-- slots, visits, one adoption request and chats. Every date is relative to the day
-- the seed runs, and slot times are Madrid times, so the demo always looks current.
--
-- One more demo account (verified, same password: Lagun-demo-2026):
--   iker@lagun.test   adopter "Iker Goikoetxea"
--
-- What each account finds:
--   adoptante@lagun.test  visited Pistacho (Can Solo) 5 days ago and can apply to adopt
--                         him; a confirmed visit to Diana (Nakama) in 3 days; a request
--                         for Txuri (Txiki) waiting for an answer; favourites; chats.
--   iker@lagun.test       visited Pistacho 20 days ago and has already applied to adopt
--                         him; cancelled a visit to Paco (Nakama).
--   cansolo@lagun.test    Iker's adoption request, Ane's completed visit, chats.
--   nakama@lagun.test     Ane's confirmed visit in its calendar.
--   protectora@lagun.test Ane's pending visit request, to confirm or reject.
-- -----------------------------------------------------------------------------

-- Household data (RN-27) of Ane, so she can apply for an adoption in the demo.
UPDATE "Adopter"
SET housing_type = 'HOUSE', has_outdoor_space = true, housing_tenure = 'OWNED', household_members = 2,
    has_children = false, has_other_pets = false, has_pet_experience = true, hours_alone_per_day = 4
WHERE user_id = (SELECT id FROM "App_user" WHERE email = 'adoptante@lagun.test');

INSERT INTO "App_user" (email, password_hash, role, email_verified_at, terms_accepted_at)
VALUES ('iker@lagun.test', '$argon2id$v=19$m=19456,t=2,p=1$MbyFPFJQLwNBv+G35ujGXA$VLOWtIsSo4xMxyvj2zrhnnlpIwsUXRgomZ4bynQeBOk',
        'ADOPTER', now(), now());

INSERT INTO "Adopter" (user_id, first_name, last_name, phone, birth_date, province_id, locality,
                       housing_type, has_outdoor_space, housing_tenure, household_members, has_children,
                       has_other_pets, other_pets_description, has_pet_experience, hours_alone_per_day)
SELECT id, 'Iker', 'Goikoetxea', '600654321', DATE '1988-09-23', 48, 'Getxo',
       'APARTMENT', true, 'RENTED', 3, true, true, 'Una gata de 6 años, muy tranquila.', true, 5
FROM "App_user" WHERE email = 'iker@lagun.test';

-- Ane's preferences questionnaire (CU-08): dogs and cats, small or medium.
INSERT INTO "Adopter_preferences" (adopter_id, sizes, sexes, activity_levels, min_age_months, max_age_months)
SELECT id, ARRAY['SMALL', 'MEDIUM'], '{}', '{}', NULL, 120
FROM "App_user" WHERE email = 'adoptante@lagun.test';

INSERT INTO adopter_preferences_species_rel (adopter_id, species_id, is_wanted, must_get_along)
SELECT u.id, sp.id, true, false
FROM "App_user" u CROSS JOIN "Species" sp
WHERE u.email = 'adoptante@lagun.test' AND sp.name IN ('Perro', 'Gato');

-- Favourites and one recent discard (within the 15 days of RN-71).
INSERT INTO adopter_pet_rel (adopter_id, pet_id, type, created_at)
SELECT u.id, p.id, f.type, now() - f.ago
FROM (VALUES
  ('adoptante@lagun.test', 'Pistacho', 'FAVORITE',  interval '8 days'),
  ('adoptante@lagun.test', 'Diana',    'FAVORITE',  interval '6 days'),
  ('adoptante@lagun.test', 'Txuri',    'FAVORITE',  interval '4 days'),
  ('adoptante@lagun.test', 'Beltza',   'DISCARDED', interval '2 days'),
  ('iker@lagun.test',      'Pistacho', 'FAVORITE',  interval '9 days'),
  ('iker@lagun.test',      'Paprika',  'FAVORITE',  interval '3 days')
) AS f (email, pet_name, type, ago)
JOIN "App_user" u ON u.email = f.email
JOIN "Pet" p ON p.name = f.pet_name;

-- Visit slots: some in the past (history) and some in the coming days, from 10:00 to 11:00.
INSERT INTO "Visit_slot" (shelter_id, starts_at, ends_at, capacity, created_at)
SELECT s.user_id,
       ((current_date + d.day_offset) + time '10:00') AT TIME ZONE 'Europe/Madrid',
       ((current_date + d.day_offset) + time '11:00') AT TIME ZONE 'Europe/Madrid',
       2, now() - interval '30 days'
FROM "Shelter" s
CROSS JOIN (VALUES (-20), (-5), (3), (5), (7), (10)) AS d (day_offset)
WHERE s.cif IN ('G20123456', 'G48123457', 'G31123458', 'G01123459');

-- Visits, each in the slot of its shelter starting on that day.
INSERT INTO "Visit" (adopter_id, shelter_id, pet_id, slot_id, status, responded_at, cancelled_by, cancelled_at,
                     attendance_marked_by, attendance_marked_at, created_at)
SELECT u.id, p.shelter_id, p.id, vs.id, v.status,
       CASE WHEN v.status IN ('CONFIRMED', 'COMPLETED') THEN now() - v.requested_ago + interval '3 hours' END,
       CASE WHEN v.status = 'CANCELLED' THEN 'ADOPTER' END,
       CASE WHEN v.status = 'CANCELLED' THEN now() - v.requested_ago + interval '1 day' END,
       CASE WHEN v.status = 'COMPLETED' THEN 'SHELTER' END,
       CASE WHEN v.status = 'COMPLETED' THEN vs.ends_at + interval '2 hours' END,
       now() - v.requested_ago
FROM (VALUES
  ('adoptante@lagun.test', 'Pistacho', -5, 'COMPLETED', interval '9 days'),
  ('iker@lagun.test',      'Pistacho', -20, 'COMPLETED', interval '25 days'),
  ('iker@lagun.test',      'Paco',      -5, 'CANCELLED', interval '10 days'),
  ('adoptante@lagun.test', 'Diana',     3, 'CONFIRMED', interval '2 days'),
  ('adoptante@lagun.test', 'Txuri',     5, 'PENDING',   interval '2 hours')
) AS v (email, pet_name, day_offset, status, requested_ago)
JOIN "App_user" u ON u.email = v.email
JOIN "Pet" p ON p.name = v.pet_name
JOIN "Visit_slot" vs ON vs.shelter_id = p.shelter_id
                    AND vs.starts_at = ((current_date + v.day_offset) + time '10:00') AT TIME ZONE 'Europe/Madrid';

-- Iker applies to adopt Pistacho after his completed visit (RN-113, RN-114).
INSERT INTO "Adoption" (adopter_id, pet_id, visit_id, questionnaire_answers, created_at)
SELECT v.adopter_id, v.pet_id, v.id,
       '{"reason": "Mis hijos y yo nos enamoramos de Pistacho en la visita. Tenemos tiempo para paseos largos.", "canAffordCosts": true}'::jsonb,
       now() - interval '1 day'
FROM "Visit" v
JOIN "App_user" u ON u.id = v.adopter_id AND u.email = 'iker@lagun.test'
JOIN "Pet" p ON p.id = v.pet_id AND p.name = 'Pistacho'
WHERE v.status = 'COMPLETED';

-- One conversation per adopter and shelter with a visit (RN-133, RN-134).
INSERT INTO "Conversation" (adopter_id, shelter_id, created_at)
SELECT adopter_id, shelter_id, min(created_at)
FROM "Visit"
GROUP BY adopter_id, shelter_id;

-- Messages: the older ones already read, the last one of each chat still unread.
INSERT INTO "Message" (conversation_id, sender_id, body, read_at, created_at)
SELECT c.id, CASE m.sender WHEN 'ADOPTER' THEN c.adopter_id ELSE c.shelter_id END, m.body,
       CASE WHEN m.unread THEN NULL ELSE now() - m.ago + interval '10 minutes' END,
       now() - m.ago
FROM (VALUES
  ('adoptante@lagun.test', 'G48123457', 'ADOPTER', '¡Hola! ¿Pistacho se lleva bien con otros perros?', interval '9 days', false),
  ('adoptante@lagun.test', 'G48123457', 'SHELTER', 'Hola, Ane. Sí, es muy sociable. Te esperamos en la visita.', interval '9 days' - interval '2 hours', false),
  ('adoptante@lagun.test', 'G48123457', 'ADOPTER', 'Gracias por la visita, Pistacho es un encanto. Me lo voy a pensar.', interval '4 days', false),
  ('adoptante@lagun.test', 'G48123457', 'SHELTER', 'Un placer. Si quieres adoptarlo, puedes enviarnos la solicitud desde su ficha.', interval '4 days' - interval '1 hour', true),
  ('adoptante@lagun.test', 'G31123458', 'ADOPTER', 'Hola, ¿puedo llevar a mi pareja a la visita de Diana?', interval '1 day', false),
  ('adoptante@lagun.test', 'G31123458', 'SHELTER', 'Claro que sí, os esperamos a los dos.', interval '20 hours', true),
  ('iker@lagun.test',      'G48123457', 'ADOPTER', 'Hola, me encantó conocer a Pistacho. Os acabo de enviar la solicitud de adopción de Pistacho.', interval '1 day', false),
  ('iker@lagun.test',      'G48123457', 'SHELTER', 'Recibida, Iker. La revisamos esta semana y te decimos algo.', interval '22 hours', true)
) AS m (email, cif, sender, body, ago, unread)
JOIN "App_user" u ON u.email = m.email
JOIN "Shelter" s ON s.cif = m.cif
JOIN "Conversation" c ON c.adopter_id = u.id AND c.shelter_id = s.user_id;

COMMIT;
