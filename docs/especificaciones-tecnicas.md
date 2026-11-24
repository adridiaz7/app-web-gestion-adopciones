# Especificaciones técnicas — Plataforma de adopción de mascotas (MVP)

> Stack tecnológico, arquitectura y convenciones del proyecto. Las reglas funcionales están en [reglas-de-negocio.md](reglas-de-negocio.md) y los casos de uso en [casos-de-uso.md](casos-de-uso.md).
>
> **Última actualización:** 24/11/2026

---

## Índice

1. [Visión general](#1-visión-general)
2. [Arquitectura Modelo-Vista-Controlador](#2-arquitectura-modelo-vista-controlador)
3. [Stack tecnológico](#3-stack-tecnológico)
4. [Estructura del repositorio](#4-estructura-del-repositorio)
5. [Decisiones técnicas](#5-decisiones-técnicas)
6. [Seguridad](#6-seguridad)
7. [Convenciones de código](#7-convenciones-de-código)
8. [Glosario castellano–inglés](#8-glosario-castellanoinglés)
9. [Decisiones pendientes](#9-decisiones-pendientes)
10. [Metodología de desarrollo: TDD](#10-metodología-de-desarrollo-tdd)

---

## 1. Visión general

- Aplicación **web para escritorio**, solo en castellano y para España (RN-184, RN-185).
- Un **frontend** en TypeScript sin framework, que se ejecuta en el navegador.
- Un **backend** en Node.js + Express que expone una **API REST** en JSON.
- Una base de datos **PostgreSQL**.

```
 Navegador                        Servidor Node.js                    Base de datos
┌──────────────┐   HTTP + JSON   ┌───────────────────────────┐   SQL   ┌────────────┐
│  Frontend    │ ──────────────► │  API REST (Express)       │ ──────► │ PostgreSQL │
│  HTML/CSS/TS │ ◄────────────── │  + tareas programadas     │ ◄────── │            │
└──────────────┘                 └───────────────────────────┘         └────────────┘
```

---

## 2. Arquitectura Modelo-Vista-Controlador

La aplicación sigue el patrón **Modelo-Vista-Controlador (MVC)**, que separa el código en tres responsabilidades:

| Capa | Responsabilidad | Dónde vive |
|---|---|---|
| **Modelo** | Los datos y las reglas de negocio: qué es una visita, cuándo se puede solicitar, qué pasa al aprobar una adopción. Es la única capa que habla con la base de datos. | Backend: `src/server/models` (acceso a datos con SQL) y `src/server/services` (reglas de negocio) |
| **Vista** | Lo que ve el usuario: pinta las pantallas y recoge sus acciones. No contiene reglas de negocio. | Frontend: `src/client` (HTML, CSS y TypeScript que manipula el DOM) |
| **Controlador** | Hace de intermediario: recibe la petición, valida el formato de los datos, llama al modelo y devuelve la respuesta. | Backend: `src/server/controllers`, con las rutas en `src/server/routes` |

### Flujo de una petición

Ejemplo: el adoptante solicita una visita (CU-23).

```
Vista (navegador)            Controlador                     Modelo
─────────────────            ───────────                     ──────
Pulsa "Enviar solicitud"
  │  POST /api/visits
  └────────────────────────► routes → middleware de sesión
                             controllers/visits
                               · valida el formato (Zod)
                               └──────────────────────────► services/visits
                                                              · comprueba RN-86 a RN-93
                                                              · models/visits → SQL (transacción)
                               ◄──────────────────────────── devuelve la visita creada
  ◄──────────────────────── responde 201 + JSON
Muestra "Solicitud enviada"
```

### Reparto de responsabilidades

- **Las reglas de negocio están en el modelo, nunca en el controlador ni en la vista.** Así se aplican igual vengan de donde vengan (API, tareas programadas, tests).
- Dentro del modelo se distinguen dos piezas: los **servicios** (`services/`) aplican las reglas (RN-xx) y coordinan las transacciones (RN-171), y los **modelos de datos** (`models/`) contienen solo las consultas SQL. Así se puede probar la lógica sin escribir SQL en ella.
- Los **controladores** solo validan el formato de la entrada (tipos, campos obligatorios, longitudes) y traducen el resultado a una respuesta HTTP. No deciden si algo está permitido.
- La **vista** valida los formularios solo para dar una respuesta rápida al usuario. La validación de verdad siempre la repite el servidor.
- Las **tareas programadas** (`jobs/`) llaman a los mismos servicios que los controladores.

---

## 3. Stack tecnológico

### Frontend

- **HTML5**: estructura y marcado semántico.
- **CSS3**: estilos, con los tokens del [sistema de diseño](ux-ui/design-system.md) como variables CSS.
- **TypeScript sin framework**: el DOM se manipula directamente.
- **Compilación con `tsc`**: el compilador oficial genera el JavaScript que carga el navegador, **sin empaquetador** (bundler). El navegador carga los módulos ES nativos (`<script type="module">`).

### Backend

- **Node.js + Express**: servidor HTTP y API REST.
- **TypeScript**: implementación del servidor y de la lógica de negocio.
- **pg (node-postgres)**: acceso a la base de datos con SQL escrito a mano y **consultas parametrizadas**, sin ORM.
- **Zod**: validación del formato de los datos de entrada.
- **@node-rs/argon2**: hash de contraseñas con Argon2id (RN-08).
- **express-rate-limit**: límite de intentos de inicio de sesión (RN-179).
- **multer**: subida de fotos (mascotas y chat) con `multipart/form-data`.

### Base de datos

- **PostgreSQL 18**: es la versión instalada en desarrollo y la que se exige. Se pueden usar sus funciones sin limitarse a versiones anteriores.

### Herramientas

- **Node.js 24** con módulos **ESM** (`"type": "module"` y `module: NodeNext`): los imports relativos llevan la extensión `.js`.
- **TypeScript en modo estricto**, con un `tsconfig` por destino: uno base común, uno para el servidor y otro para el cliente.
- **tsx**: ejecuta el TypeScript directamente durante el desarrollo (`npm run dev`).
- **Vitest** y **supertest**: tests unitarios y de integración de la API.
- **ESLint** con `typescript-eslint` en modo `strict` (`no-explicit-any` da error).
- **Variables de entorno** con la opción nativa `node --env-file`, sin `dotenv`.

---

## 4. Estructura del repositorio

Un único `package.json` para todo el proyecto.

```
lagun-app-adopciones/
├── db/
│   ├── schema.sql           Crea las tablas y carga los catálogos
│   └── seed.sql             Datos de la demo (se ejecuta después de schema.sql)
├── docs/                    Documentación funcional y técnica
├── src/
│   ├── server/              Backend
│   │   ├── routes/          Rutas de la API → controladores        (Controlador)
│   │   ├── controllers/     Validan la entrada y responden         (Controlador)
│   │   ├── middlewares/     Sesión, roles, errores, rate limit     (Controlador)
│   │   ├── services/        Reglas de negocio y transacciones      (Modelo)
│   │   ├── models/          Consultas SQL                          (Modelo)
│   │   ├── jobs/            Tareas programadas (CU-45 a CU-56)
│   │   ├── db/              Conexión a PostgreSQL (pool de pg)
│   │   ├── config.ts        Lectura y validación de variables de entorno
│   │   └── app.ts           Creación de la app de Express
│   ├── client/              Frontend                               (Vista)
│   │   ├── views/           Una vista por pantalla
│   │   ├── components/      Piezas reutilizables (tarjeta, modal…)
│   │   ├── api/             Funciones que llaman a la API
│   │   └── styles/          CSS y tokens del sistema de diseño
│   └── shared/              Tipos compartidos entre servidor y cliente
├── tests/
│   ├── unit/                Tests unitarios (servicios y reglas de negocio)
│   ├── integration/         Tests de la API con supertest y base de datos de test
│   └── locked-tests.json    Tests bloqueados de funcionalidades terminadas (sección 10)
├── scripts/
│   └── test-lock.ts         Candado de tests (sección 10)
├── .claude/
│   └── settings.json        Hooks de Claude Code que aplican el candado (sección 10)
├── tsconfig.base.json
├── tsconfig.server.json
├── tsconfig.client.json
└── package.json
```

> **Nota sobre `shared/`:** como el cliente no usa empaquetador, el navegador no puede cargar paquetes de `node_modules` por su nombre (`import { z } from "zod"`). Por eso `shared/` contiene **solo tipos de TypeScript**, que desaparecen al compilar. Los esquemas de Zod se quedan en el servidor.

---

## 5. Decisiones técnicas

| Tema | Decisión |
|---|---|
| Estructura del repositorio | Un único `package.json` con `src/server`, `src/client` y `src/shared`. |
| Cómo se sirve el frontend | Express sirve **desde el mismo origen** el frontend compilado (`express.static`) y la API (`/api/...`). Así no hace falta CORS y la cookie de sesión funciona sin configuración extra. Se arranca todo con un solo comando. |
| Navegación del frontend | **Aplicación de una sola página (SPA)**: un único `index.html` y un router propio en TypeScript que cambia la vista sin recargar. Usa la **History API** (direcciones limpias como `/mascotas/7`). Express devuelve `index.html` para cualquier ruta que no empiece por `/api` ni sea un archivo estático. |
| Creación de la base de datos | `db/schema.sql` **borra y vuelve a crear** todas las tablas, restricciones e índices, y carga los catálogos (provincias, especies y razas), en una sola transacción. Se edita directamente cuando cambia el modelo: no hay migraciones, porque la app no tiene datos reales que conservar. La base de datos en sí (`CREATE DATABASE`) se crea una sola vez por equipo. |
| Datos de prueba | `db/seed.sql` se ejecuta después de `schema.sql` y carga los datos de la demo. Se crea en versión mínima cuando haga falta probar la app a mano (administrador, una protectora validada y unas pocas mascotas) y se completa al final. **Los tests nunca lo usan**: parten de `schema.sql` y crean sus propios datos, así que los cambios en el seed no afectan a los tests bloqueados. `npm run db:reset` ejecuta los dos archivos seguidos. |
| Base de datos | Modelo en [modelo-entidad-relacion.md](modelo-entidad-relacion.md). |
| Sesiones | Tabla de sesiones en PostgreSQL y cookie `httpOnly`, `SameSite=Lax` (y `Secure` en producción). Sin JWT. La sesión es deslizante de 30 días (RN-176). Al cerrar sesión o suspender una cuenta, la sesión se borra de la tabla y deja de valer al instante. |
| Tareas programadas | Un `setInterval` dentro del propio servidor ejecuta periódicamente los procesos automáticos (caducar visitas, marcarlas como realizadas, recordatorios, levantar bloqueos…), sin librerías externas. Cada tarea es **idempotente**: si se ejecuta dos veces, el resultado es el mismo. |
| Chat | El navegador pide los mensajes nuevos cada pocos segundos (*polling*) mientras la conversación está abierta. Sin WebSockets. Es la opción con menos piezas que puedan fallar. |
| Contador de notificaciones | Mismo mecanismo de *polling*, con un intervalo más largo. |
| Fechas y horas | Se guardan con zona horaria (`timestamptz`) y se muestran en la hora de España (`Europe/Madrid`). |
| Imágenes | Se suben con **multer** y se guardan en disco, en `uploads/` (fuera de git), con un **nombre aleatorio** (nunca el original). Solo se aceptan imágenes, comprobando el contenido real y no solo la extensión, y con tamaño máximo limitado. En la base de datos se guarda solo la ruta (RN-52). Express sirve `/uploads` como archivos estáticos. Las fotos de la demo van en el repositorio y el seed las copia a `uploads/`. |

---

## 6. Seguridad

- Contraseñas con **Argon2id**, de 12 a 256 caracteres (RN-08, RN-175).
- **Consultas parametrizadas** siempre: nunca se concatenan datos del usuario en el SQL.
- **Validación con Zod** de toda entrada en el servidor (cuerpo, parámetros y query).
- **Autorización en el servidor**: cada endpoint comprueba el rol y que el recurso pertenece al usuario (por ejemplo, que una protectora solo gestiona sus mascotas).
- **Rate limit** en el inicio de sesión (RN-179) y esperas para reenviar enlaces (RN-180 a RN-182).
- **Cookies de sesión** `httpOnly` para que el JavaScript de la página no pueda leerlas.
- **Respuestas que no revelan información**: el registro y la recuperación de contraseña responden igual exista o no el email (RN-182).
- Los secretos van en variables de entorno y el archivo `.env` **no se sube** al repositorio.

---

## 7. Convenciones de código

- **Todo el código en inglés**: nombres de tablas, columnas, valores de estado, variables, funciones, rutas de la API y mensajes de commit. Los textos que ve el usuario están en castellano.
- La **documentación** (`docs/`) sigue en castellano. Para relacionar los nombres de los documentos con los del código se usa el [glosario](#8-glosario-castellanoinglés).
- Base de datos (detalle en el [modelo entidad-relación](modelo-entidad-relacion.md#nombres)):
  - **Tablas principales**: primera letra en mayúscula y el resto en `snake_case` (`App_user`, `Visit_slot`). Se escriben **siempre entre comillas dobles** en el SQL (`"Visit_slot"`), porque PostgreSQL pasa a minúsculas los nombres sin comillas.
  - **Tablas intermedias** (relaciones muchos a muchos): `snake_case` con los nombres de las dos tablas relacionadas y el sufijo `_rel` (`pet_species_rel`).
  - **Columnas**: `snake_case` (`created_at`).
- TypeScript en `camelCase` para variables y funciones y `PascalCase` para tipos.
- Los **valores de estado** se escriben en mayúsculas (`PENDING`, `CONFIRMED`).
- Las reglas de negocio se citan en el código con su identificador cuando ayuda a entenderlo (`// RN-90: cupo de visitas`).
- Los **parámetros configurables** (sección 16 de las reglas) se leen de la configuración, no se escriben fijos en el código.

---

## 8. Glosario castellano–inglés

> Los nombres de las tablas son los del [modelo entidad-relación](modelo-entidad-relacion.md).

### Entidades

| Documentación | Tabla |
|---|---|
| Usuario | `App_user` (`user` es una palabra reservada de PostgreSQL) |
| Adoptante | `Adopter` |
| Protectora | `Shelter` |
| Administrador | `App_user` con `role = 'ADMIN'` |
| Mascota | `Pet` |
| Especie / Raza | `Species` / `Breed` |
| Provincia | `Province` |
| Foto de la mascota | `Pet_photo` |
| Preferencias | `Adopter_preferences` (+ `adopter_preferences_species_rel`, `adopter_preferences_breed_rel`) |
| Convivencia con otras especies | `pet_species_rel` |
| Sesión / Enlace de email | `Session` / `Email_token` |
| Valoración (favorito o descarte) | `adopter_pet_rel` (`FAVORITE`, `DISCARDED`) |
| Turno de visita | `Visit_slot` |
| Visita | `Visit` |
| Solicitud de adopción / Adopción | `Adoption` |
| Cuestionario de adopción | columna `Adoption.questionnaire_answers` |
| Conversación / Mensaje | `Conversation` / `Message` |
| Notificación | `Notification` |
| Bloqueo | `Block` |
| Suspensión | `Suspension` |
| Incidencia | `Incident` |
| Nota interna | `Adopter_note` |
| Registro de auditoría | `Audit_log` |

### Estados

| Documentación | Código |
|---|---|
| **Rol:** Adoptante, Protectora, Administrador | `ADOPTER`, `SHELTER`, `ADMIN` |
| **Validación de la protectora:** Pendiente, Validada, Rechazada | `PENDING`, `VALIDATED`, `REJECTED` |
| **Mascota:** Disponible, Reservada, Adoptada, Baja | `AVAILABLE`, `RESERVED`, `ADOPTED`, `UNLISTED` |
| **Visita:** Pendiente, Confirmada, Rechazada, Cancelada, Caducada, Anulada, Realizada, No asistida | `PENDING`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `EXPIRED`, `VOIDED`, `COMPLETED`, `NO_SHOW` |
| **Adopción:** Pendiente, Aprobada, Rechazada, No seleccionada, Cancelada, Anulada, Completada, Devuelta | `PENDING`, `APPROVED`, `REJECTED`, `NOT_SELECTED`, `CANCELLED`, `VOIDED`, `COMPLETED`, `RETURNED` |
| **Incidencia:** Abierta, En revisión, Resuelta, Descartada | `OPEN`, `IN_REVIEW`, `RESOLVED`, `DISMISSED` |

---

## 9. Decisiones pendientes

| Tema | Propuesta actual | Estado |
|---|---|---|
| Entorno de la demo | La demo se hará en un portátil distinto al equipo de desarrollo. Propuesta: instalar Node y PostgreSQL en el portátil, clonar el repositorio y prepararlo con `npm run db:reset` (schema + seed). Las fotos ya están decididas (multer, sección 5). | Pendiente de decidir |
| Prioridad de los casos de uso para la demo | Propuesta: registro e inicio de sesión → galería y ficha → descubrir y favoritos → turnos y visitas → chat. | Pendiente de decidir |
| Envío de emails | Se decidirá más adelante. Mientras tanto, en desarrollo los enlaces de verificación y de recuperación de contraseña se escriben en la consola del servidor, para que esos flujos se puedan probar. | Aplazado |
| Base de datos de los tests | Una base de datos aparte para los tests de integración. | Pendiente de confirmar |
| Datos de prueba para la demo | Protectoras y mascotas ficticias con fotos de licencia libre guardadas en el repositorio, usuarios de demo con contraseña conocida, historial ya hecho (visitas, chat, favoritos), fechas relativas al día de ejecución y un `npm run db:reset` para dejarlo todo limpio antes de presentar. | Para el final del desarrollo |

---

## 10. Metodología de desarrollo: TDD

### 10.1 Ciclo de trabajo

Todo el código se desarrolla con **TDD (Test-Driven Development)**, en ciclos cortos:

1. **Rojo:** se escribe un test para el siguiente comportamiento y se ejecuta para **verlo fallar**. Si pasa sin haber escrito código, el test no comprueba nada nuevo.
2. **Verde:** se escribe el **mínimo código** que hace pasar el test.
3. **Refactorizar:** se mejora el código sin cambiar su comportamiento, con todos los tests en verde.

| Tipo de test | Qué prueba | Herramientas |
|---|---|---|
| **Unitario** (`tests/unit`) | Servicios y reglas de negocio de forma aislada: cada regla RN-xx y cada excepción de un caso de uso. | Vitest |
| **Integración** (`tests/integration`) | Endpoints de la API de principio a fin, con base de datos de test: códigos HTTP, permisos por rol y efectos en la base de datos. | Vitest + supertest |

- El nombre del test cita la regla o el caso de uso que comprueba, por ejemplo: `it("RN-87: rechaza una visita con menos de 48 h de antelación")`.
- Un comportamiento nuevo se cubre con **tests nuevos**, no editando tests existentes.

### 10.2 Los tests de funcionalidades terminadas no se modifican

- Mientras se desarrolla una funcionalidad, sus tests pueden evolucionar dentro del ciclo rojo-verde-refactorizar.
- Cuando la funcionalidad está **terminada** (todos sus tests en verde y el trabajo listo para commit), sus tests se **bloquean** y **no se vuelven a modificar ni a borrar** en tareas posteriores.
- Si en algún momento resulta **imprescindible** cambiar un test bloqueado, se pide antes el **visto bueno explícito del responsable del proyecto**, explicando el motivo. Sin ese visto bueno, no se toca.

### 10.3 Candado de tests (`scripts/test-lock.ts`)

El script guarda en `tests/locked-tests.json` una huella (hash SHA-256) de cada test bloqueado y comprueba que no cambie. Se ejecuta directamente con Node 24, sin compilar.

| Comando | Para qué |
|---|---|
| `node scripts/test-lock.ts check` | Comprueba que ningún test bloqueado se ha modificado o borrado. Falla (código de salida 1) si alguno ha cambiado. |
| `node scripts/test-lock.ts lock --feature "CU-23 Solicitar una visita" tests/unit/visits` | Bloquea los tests de una funcionalidad terminada. Acepta archivos `*.test.ts` / `*.spec.ts` o carpetas. |
| `node scripts/test-lock.ts relock --approved "<motivo y quién lo aprobó>" <archivo>` | Registra un cambio **aprobado** en un test bloqueado. |
| `node scripts/test-lock.ts unlock --approved "<motivo y quién lo aprobó>" <archivo>` | Registra el borrado **aprobado** de un test bloqueado. |
| `node scripts/test-lock.ts list` | Muestra los tests bloqueados agrupados por funcionalidad. |

**Cuándo se aplica: hooks de Claude Code** (`.claude/settings.json`)

El script se ejecuta automáticamente en tres momentos del trabajo de Claude Code:

| Momento | Modo del script | Qué hace |
|---|---|---|
| **Antes** de editar un archivo o ejecutar un comando (`PreToolUse`) | `hook-pre` | Si Claude va a editar un **test bloqueado**, Claude Code **pide confirmación al responsable** y muestra el motivo. Si va a editar `tests/locked-tests.json` a mano, lo **deniega**. Si va a ejecutar `relock` o `unlock`, también **pide confirmación**: registrar una aprobación solo lo decide el responsable. |
| **Después** de un comando de terminal (`PostToolUse`) | `hook-post` | Comprueba si el comando ha cambiado o borrado algún test bloqueado (por ejemplo, con `sed` o `rm`) y, si es así, se lo comunica a Claude para que lo restaure. |
| **Al terminar** cada turno (`Stop`) | `hook-stop` | Si queda algún test bloqueado modificado sin aprobación, Claude **no puede dar el turno por terminado**. Si vuelve a ocurrir en el mismo turno, se avisa al responsable en lugar de bloquear, para no entrar en un bucle. |

Además, cuando exista el `package.json`, el script `pretest` ejecutará `node scripts/test-lock.ts check`, de modo que `npm test` falle si se ha tocado un test bloqueado.

**Qué detecta:**
- Un test bloqueado **modificado** o **borrado**.
- Un manifiesto **manipulado** para tapar el cambio, por ejemplo recalculando el hash a mano: compara el manifiesto con el del último commit y exige una entrada nueva en el historial de aprobaciones por cada test cambiado o quitado.
- Un **historial de aprobaciones** editado o recortado.

Los saltos de línea se normalizan antes de calcular la huella, para que un test idéntico no parezca modificado en Windows (CRLF) y en Linux o macOS (LF).

> Los hooks controlan el trabajo de **Claude Code**. Los cambios que una persona haga a mano en su editor no pasan por ellos, pero `check` (y `npm test`) los detectan igualmente. Cualquier `relock` o `unlock` queda en el historial con su motivo, y sin la aprobación explícita del responsable no se usa.
