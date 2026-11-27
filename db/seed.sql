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

-- This file is UTF-8: psql must not read it with the console's code page (WIN1252).
SET client_encoding = 'UTF8';

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
       'hola@txiki.test', 'De lunes a sábado, de 10:00 a 14:00', 'VALIDATED', now() - interval '35 days'
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
       s.contact, s.website, s.hours, 'VALIDATED', now() - interval '35 days'
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
  ('G31123458', 'Diana',    '/uploads/seed/mascotas/gato-diana/1.jpg', 1),
  ('G31123458', 'Diana',    '/uploads/seed/mascotas/gato-diana/2.jpg', 2),
  ('G31123458', 'Paco',     '/uploads/seed/mascotas/gato-paco/1.jpg', 1),
  ('G31123458', 'Paco',     '/uploads/seed/mascotas/gato-paco/2.jpg', 2),
  ('G31123458', 'Paco',     '/uploads/seed/mascotas/gato-paco/3.jpg', 3),
  ('G01123459', 'Paprika',  '/uploads/seed/mascotas/gato-paprika/1.jpg', 1),
  ('G01123459', 'Paprika',  '/uploads/seed/mascotas/gato-paprika/2.jpg', 2),
  ('G01123459', 'Paprika',  '/uploads/seed/mascotas/gato-paprika/3.jpg', 3),
  ('G48123457', 'Pistacho', '/uploads/seed/mascotas/perro-pistacho/1.jpg', 1),
  ('G48123457', 'Pistacho', '/uploads/seed/mascotas/perro-pistacho/2.jpg', 2),
  ('G48123457', 'Rocky',    '/uploads/seed/mascotas/perro-rocky/1.jpg', 1),
  ('G48123457', 'Rocky',    '/uploads/seed/mascotas/perro-rocky/2.jpg', 2),
  ('G48123457', 'Rocky',    '/uploads/seed/mascotas/perro-rocky/3.jpg', 3),
  ('G48123457', 'Shiro',    '/uploads/seed/mascotas/perro-shiro/1.jpg', 1),
  ('G48123457', 'Shiro',    '/uploads/seed/mascotas/perro-shiro/2.jpg', 2),
  ('G48123457', 'Shiro',    '/uploads/seed/mascotas/perro-shiro/3.jpg', 3),
  ('G48123457', 'Shiro',    '/uploads/seed/mascotas/perro-shiro/4.jpg', 4),
  ('G31123458', 'Titán',    '/uploads/seed/mascotas/perro-titan/1.jpg', 1),
  ('G31123458', 'Titán',    '/uploads/seed/mascotas/perro-titan/2.jpg', 2),
  ('G01123459', 'Torpedo',  '/uploads/seed/mascotas/perro-torpedo/1.jpg', 1),
  ('G01123459', 'Torpedo',  '/uploads/seed/mascotas/perro-torpedo/2.jpg', 2),
  ('G01123459', 'Torpedo',  '/uploads/seed/mascotas/perro-torpedo/3.jpg', 3),
  ('G01123459', 'Torpedo',  '/uploads/seed/mascotas/perro-torpedo/4.jpg', 4),
  ('G01123459', 'Torpedo',  '/uploads/seed/mascotas/perro-torpedo/5.jpg', 5)
) AS ph (cif, pet_name, path, position)
JOIN "Shelter" s ON s.cif = ph.cif
JOIN "Pet" pet ON pet.name = ph.pet_name AND pet.shelter_id = s.user_id;

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
--
-- Timing (T-55): Ane's pending request to Txuri is created 5 minutes before the reset,
-- and the shelter has 24 h to answer it (RN-94). So it can be confirmed or rejected for
-- about 23 h 55 min after npm run db:reset; then the job of RN-95 expires it. A reset the
-- evening before the demo is fine; for a demo more than a day later, reset again.
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
  ('adoptante@lagun.test', 'G48123457', 'Pistacho', 'FAVORITE',  interval '8 days'),
  ('adoptante@lagun.test', 'G31123458', 'Diana',    'FAVORITE',  interval '6 days'),
  ('adoptante@lagun.test', 'G20123456', 'Txuri',    'FAVORITE',  interval '4 days'),
  ('adoptante@lagun.test', 'G20123456', 'Beltza',   'DISCARDED', interval '2 days'),
  ('iker@lagun.test',      'G48123457', 'Pistacho', 'FAVORITE',  interval '9 days'),
  ('iker@lagun.test',      'G01123459', 'Paprika',  'FAVORITE',  interval '3 days')
) AS f (email, cif, pet_name, type, ago)
JOIN "App_user" u ON u.email = f.email
JOIN "Shelter" s ON s.cif = f.cif
JOIN "Pet" p ON p.name = f.pet_name AND p.shelter_id = s.user_id;

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
       -- RN-106: with no no-show marked, the system marks the visit as completed 48 h after it.
       CASE WHEN v.status = 'COMPLETED' THEN 'SYSTEM' END,
       CASE WHEN v.status = 'COMPLETED' THEN vs.ends_at + interval '48 hours' END,
       now() - v.requested_ago
FROM (VALUES
  ('adoptante@lagun.test', 'G48123457', 'Pistacho', -5, 'COMPLETED', interval '9 days'),
  ('iker@lagun.test',      'G48123457', 'Pistacho', -20, 'COMPLETED', interval '25 days'),
  ('iker@lagun.test',      'G31123458', 'Paco',      -5, 'CANCELLED', interval '10 days'),
  ('adoptante@lagun.test', 'G31123458', 'Diana',     3, 'CONFIRMED', interval '2 days'),
  -- Requested 5 minutes before the reset: it stays pending for almost the full 24 h of RN-94
  -- before the job of RN-95 expires it (see the header).
  ('adoptante@lagun.test', 'G20123456', 'Txuri',     5, 'PENDING',   interval '5 minutes')
) AS v (email, cif, pet_name, day_offset, status, requested_ago)
JOIN "App_user" u ON u.email = v.email
JOIN "Shelter" s ON s.cif = v.cif
JOIN "Pet" p ON p.name = v.pet_name AND p.shelter_id = s.user_id
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
JOIN "Shelter" s ON s.user_id = p.shelter_id AND s.cif = 'G48123457'
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

-- -----------------------------------------------------------------------------
-- Notifications and audit log (T-55), consistent with the history above, so the bell
-- and the administrator's activity (CU-43) are not empty in the demo. They use the same
-- types, texts and details as the services (notification-templates.ts, audit()).
-- -----------------------------------------------------------------------------

-- formatDateTime() of notification-templates.ts: "3 de diciembre de 2026 a las 10:00", Madrid time.
CREATE FUNCTION pg_temp.es_datetime(t timestamptz) RETURNS text LANGUAGE sql STABLE
RETURN extract(day FROM t AT TIME ZONE 'Europe/Madrid')::int || ' de '
    || (ARRAY['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
              'septiembre', 'octubre', 'noviembre', 'diciembre'])[extract(month FROM t AT TIME ZONE 'Europe/Madrid')::int]
    || ' de ' || extract(year FROM t AT TIME ZONE 'Europe/Madrid')::int
    || ' a las ' || extract(hour FROM t AT TIME ZONE 'Europe/Madrid')::int
    || ':' || to_char(t AT TIME ZONE 'Europe/Madrid', 'MI');

-- CU-24: each confirmed visit told the adopter. Those already held are read; Ane's upcoming one is not.
INSERT INTO "Notification" (user_id, type, title, body, visit_id, read_at, created_at)
SELECT v.adopter_id, 'VISIT_CONFIRMED' AS type, 'Visita confirmada',
       'La protectora ha confirmado tu visita para conocer a ' || p.name || ' el ' || pg_temp.es_datetime(vs.starts_at) || '.',
       v.id, CASE WHEN v.status = 'COMPLETED' THEN v.responded_at + interval '1 hour' END, v.responded_at
FROM "Visit" v
JOIN "Pet" p ON p.id = v.pet_id
JOIN "Visit_slot" vs ON vs.id = v.slot_id
WHERE v.status IN ('CONFIRMED', 'COMPLETED');

-- CU-25: Iker cancelled his visit to Paco, so Nakama was told (still unread).
INSERT INTO "Notification" (user_id, type, title, body, visit_id, created_at)
SELECT v.shelter_id, 'VISIT_CANCELLED_BY_ADOPTER' AS type, 'Visita cancelada por el adoptante',
       'El adoptante ha cancelado la visita para conocer a ' || p.name || ' el ' || pg_temp.es_datetime(vs.starts_at)
         || '. La plaza del turno queda libre.',
       v.id, v.cancelled_at
FROM "Visit" v
JOIN "Pet" p ON p.id = v.pet_id
JOIN "Visit_slot" vs ON vs.id = v.slot_id
WHERE v.status = 'CANCELLED' AND v.cancelled_by = 'ADOPTER';

-- CU-54, RN-199: Paprika (a small cat) matches Ane's questionnaire (unread).
INSERT INTO "Notification" (user_id, type, title, body, pet_id, created_at)
SELECT u.id, 'NEW_COMPATIBLE_PET' AS type, 'Nueva mascota compatible',
       p.name || ', de ' || s.name || ', encaja con tus preferencias y está disponible para adopción.',
       p.id, now() - interval '1 hour'
FROM "App_user" u
CROSS JOIN "Shelter" s
JOIN "Pet" p ON p.name = 'Paprika' AND p.shelter_id = s.user_id
WHERE u.email = 'adoptante@lagun.test' AND s.cif = 'G01123459';

-- RN-208: CU-39, the administrator validated the four shelters.
INSERT INTO "Audit_log" (actor_user_id, action, entity_type, entity_id, details, created_at)
SELECT admin.id, 'SHELTER_VALIDATED', 'Shelter', s.user_id,
       '{"before": {"validationStatus": "PENDING"}, "after": {"validationStatus": "VALIDATED"}}'::jsonb, s.validated_at
FROM "Shelter" s
CROSS JOIN (SELECT id FROM "App_user" WHERE email = 'admin@lagun.test') admin
WHERE s.validation_status = 'VALIDATED';

-- RN-208: the life of each visit, as the services and the jobs record it.
INSERT INTO "Audit_log" (actor_user_id, action, entity_type, entity_id, details, created_at)
SELECT e.actor, e.action, 'Visit', e.visit_id, e.details, e.at
FROM (
  -- CU-23: every visit was requested by the adopter.
  SELECT v.id AS visit_id, v.adopter_id AS actor, 'VISIT_REQUESTED' AS action,
         '{"after": {"status": "PENDING"}}'::jsonb AS details, v.created_at AS at
  FROM "Visit" v
  UNION ALL
  -- CU-24: confirmed by the shelter.
  SELECT v.id, v.shelter_id, 'VISIT_CONFIRMED',
         '{"before": {"status": "PENDING"}, "after": {"status": "CONFIRMED"}}'::jsonb, v.responded_at
  FROM "Visit" v WHERE v.status IN ('CONFIRMED', 'COMPLETED')
  UNION ALL
  -- CU-25: cancelled by the adopter while still pending.
  SELECT v.id, v.adopter_id, 'VISIT_CANCELLED',
         '{"before": {"status": "PENDING"}, "after": {"status": "CANCELLED", "cancelledBy": "ADOPTER"}}'::jsonb, v.cancelled_at
  FROM "Visit" v WHERE v.status = 'CANCELLED'
  UNION ALL
  -- CU-46, RN-106: marked as completed by the system (no actor).
  SELECT v.id, NULL, 'VISIT_COMPLETED',
         '{"before": {"status": "CONFIRMED"}, "after": {"status": "COMPLETED", "attendanceMarkedBy": "SYSTEM"}}'::jsonb,
         v.attendance_marked_at
  FROM "Visit" v WHERE v.status = 'COMPLETED'
) e;

-- RN-208: CU-27, Iker's adoption request.
INSERT INTO "Audit_log" (actor_user_id, action, entity_type, entity_id, details, created_at)
SELECT a.adopter_id, 'ADOPTION_REQUESTED', 'Adoption', a.id,
       jsonb_build_object('after', jsonb_build_object('status', 'PENDING', 'visitId', a.visit_id)), a.created_at
FROM "Adoption" a;

COMMIT;
