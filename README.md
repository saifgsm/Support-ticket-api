# Support Ticket API

API REST de gestion des tickets et des comptes. Le projet n'inclut aucune interface utilisateur : toutes les opérations se font avec des requêtes HTTP (Postman, Insomnia ou un client frontend ajouté séparément).

## Architecture routes / contrôleurs / services

Le guide pédagogique [docs/guide-nodejs.md](docs/guide-nodejs.md) explique Node.js, HTTP, le rôle des dossiers et le parcours d'une requête avec des schémas.

```text
src/
├── server.ts                   # Ouvre le port et arrête proprement le serveur
├── app.ts                      # Configure Express, limites, routes et erreurs
├── openapi.ts                  # Spécification OpenAPI
├── db.ts                       # Client Prisma partagé
├── errors.ts                   # Erreurs HTTP de l'application
├── routes/
│   ├── auth.routes.ts            # URLs et méthodes d'authentification
│   ├── admin.routes.ts           # URLs d'administration et protections
│   └── tickets.routes.ts         # URLs des tickets et protections
├── controllers/
│   ├── auth.controller.ts        # Requêtes/réponses d'authentification
│   ├── admin.controller.ts       # Requêtes/réponses d'administration
│   └── tickets.controller.ts    # Requêtes/réponses des tickets
├── services/
│   ├── auth.service.ts           # Connexion, invitations, tokens et mots de passe
│   ├── admin.service.ts          # Création et gestion des comptes
│   ├── tickets.service.ts        # Règles métier et accès aux tickets
│   └── email.service.ts          # Envoi des e-mails via Resend
├── modules/
│   ├── validation/validate-body.ts # Fonction de validation Zod réutilisable
│   ├── auth/auth.schemas.ts         # Schémas des requêtes d'authentification
│   ├── admin/admin.schemas.ts       # Schémas des requêtes d'administration
│   └── tickets/tickets.schemas.ts   # Schémas des requêtes de tickets
├── middlewares/
│   └── auth.middleware.ts        # Authentification et contrôle des rôles
├── utils/
│   ├── security.ts               # Hachage des mots de passe et signature JWT
│   ├── http-response.ts          # Format commun des réponses réussies
│   └── rate-limit.ts             # Limitation des tentatives par adresse IP
└── scripts/
    └── create-super-admin.ts    # Initialisation du premier super admin
tests/
└── api.integration.test.ts     # Tests HTTP avec une base de test dédiée
.github/workflows/ci.yml        # Vérifications automatiques à chaque push/PR
```

Le rôle de chaque couche est distinct :

- **Routes** associent une méthode HTTP et une URL à un contrôleur, et branchent les middlewares. Elles ne contiennent pas de requêtes Prisma.
- **Modules de validation** décrivent la forme attendue des corps de requête avec Zod. `validateBody(schema)` appelle `safeParse`; si les données sont invalides, l'API répond `400` avec le détail des champs. Sinon, le résultat nettoyé/validé est transmis au contrôleur.
- **Contrôleurs** lisent la requête HTTP, appellent le service concerné et renvoient la réponse JSON avec le bon code HTTP.
- **Services** appliquent les règles métier et accèdent à la base via Prisma. Le service d'authentification utilise aussi les modules de sécurité et d'e-mail.
- **Middlewares** vérifient le token et les rôles avant d'autoriser l'appel d'un contrôleur.

Exemple de parcours pour `POST /admin/users` : `server.ts` monte `admin.routes.ts` → la route branche les middlewares qui vérifient le token et le rôle super admin → `validateBody(createUserSchema)` vérifie le JSON → `admin.controller.ts` transmet les données validées → `admin.service.ts` crée le compte dans PostgreSQL avec Prisma et demande l'envoi de l'invitation à `email.service.ts` → le contrôleur renvoie le résultat JSON.

### Schéma d'une requête Node.js

```mermaid
sequenceDiagram
    participant Client as Postman / application
    participant Net as HTTP
    participant Node as Node.js + Express
    participant Mid as Middlewares
    participant Route as Route
    participant Ctrl as Contrôleur
    participant Svc as Service
    participant Prisma
    participant DB as PostgreSQL
    participant Mail as Resend

    Client->>Net: Requête HTTP (méthode, URL, headers, JSON)
    Net->>Node: Requête reçue par le serveur
    Node->>Mid: Parse le JSON, limite les requêtes, ajoute requestId
    Mid->>Route: Vérifie token/rôle et valide les données avec Zod
    Route->>Ctrl: Appelle le contrôleur associé à l'URL
    Ctrl->>Svc: Appelle la fonction métier
    Svc->>Prisma: Demande de lecture ou écriture
    Prisma->>DB: Requête SQL paramétrée
    DB-->>Prisma: Résultat
    opt Une action envoie un e-mail
      Svc->>Mail: Requête HTTPS avec la clé Resend du serveur
      Mail-->>Svc: Résultat de l'envoi
    end
    Svc-->>Ctrl: Données métier
    Ctrl-->>Client: Réponse JSON avec code HTTP
```

Node.js exécute le JavaScript du serveur avec le moteur V8. Express reçoit chaque requête et la fait passer dans les fonctions middleware puis dans la route correspondante. Les opérations d'entrée/sortie, comme PostgreSQL ou Resend, sont asynchrones (`async` / `await`) : Node peut continuer à traiter d'autres requêtes pendant qu'il attend leur réponse.

Pour étudier le code dans l'ordre, suis le parcours d'une route dans `src/routes`, puis ouvre son contrôleur dans `src/controllers`, son service dans `src/services`, et enfin les modèles dans `prisma/schema.prisma`.

## Schéma de la base de données

Le modèle Prisma dans `prisma/schema.prisma` décrit les tables, leurs champs et leurs relations. Ce diagramme résume les relations principales :

```mermaid
erDiagram
    USER ||--o{ REFRESH_TOKEN : possede
    USER ||--o{ PASSWORD_RESET_TOKEN : demande
    USER o|--o{ AUDIT_LOG : agit
    USER o|--o{ AUDIT_LOG : cible
    USER o|--o{ TICKET : cree
    USER o|--o{ TICKET_AI_DRAFT : genere
    USER o|--o{ COMMENT : ecrit
    TICKET ||--o{ TICKET_AI_DRAFT : conserve
    TICKET ||--o{ COMMENT : contient
    COMMENT o|--o| COMMENT : reponse_IA

    USER {
        string id PK
        string email UK
        string name
        string passwordHash
        Role role
        UserStatus status
        int tokenVersion
        datetime invitationExpiresAt
    }

    REFRESH_TOKEN {
        string id PK
        string tokenHash UK
        string userId FK
        datetime expiresAt
        datetime revokedAt
    }

    PASSWORD_RESET_TOKEN {
        string id PK
        string tokenHash UK
        string userId FK
        datetime expiresAt
        datetime usedAt
    }

    AUDIT_LOG {
        string id PK
        string actorId FK
        string targetUserId FK
        string action
        json details
        datetime createdAt
    }

    TICKET {
        uuid id PK
        string title
        string description
        TicketCategory category
        string status
        string createdById FK
    }

    TICKET_AI_DRAFT {
        string id PK
        uuid ticketId FK
        string generatedById FK
        string model
        json response
        datetime createdAt
    }

    COMMENT {
        string id PK
        string content
        CommentType type
        uuid ticketId FK
        string authorId FK
        AiGenerationStatus aiStatus
        string replyToId UK
        datetime createdAt
    }
```

`TicketCategory` est l'énumération `AUTHENTICATION`, `DISPLAY`, `PERFORMANCE`, `NETWORK`, `BUG`, `PAYMENT`, `ACCOUNT`, `OTHER`. La migration attribue `OTHER` aux tickets existants pour conserver leurs données.

`Ticket.id` est un UUID généré par Prisma. `Comment.ticketId` et `TicketAiDraft.ticketId` utilisent le même type UUID. La migration de conversion conserve les tickets, commentaires et brouillons en remappant leurs clés étrangères, mais les anciens numéros de ticket changent : les anciennes URL Postman doivent être remplacées par les UUID retournés par l'API. Fais une sauvegarde de la base avant d'appliquer cette migration.

- Un `USER` peut avoir plusieurs refresh tokens et jetons de récupération; chacun appartient à un seul compte. Les tokens sont enregistrés sous forme de hash pour pouvoir être révoqués sans conserver le secret original.
- Un `USER` peut créer plusieurs tickets. `createdById` est facultatif : un ticket peut ne pas avoir de créateur associé, par exemple si le compte est supprimé.
- Un ticket peut avoir plusieurs `TICKET_AI_DRAFT`; chaque génération est enregistrée avec son résultat, le modèle utilisé et le technicien demandeur. Supprimer le ticket supprime ses brouillons; supprimer le compte du technicien conserve le brouillon en retirant sa référence.
- Un ticket peut avoir plusieurs `COMMENT`. Les commentaires `USER` comptent dans la limite de 20; une réponse `AI` peut être liée à un seul commentaire utilisateur par `replyToId`. Les fichiers et images ne sont pas pris en charge dans cette conversation.
- `Role` et `UserStatus` sont des énumérations définies dans Prisma. Elles limitent les rôles et états possibles d'un compte.
- `AUDIT_LOG` mémorise qui a fait une action sensible, quel compte était visé et les détails utiles. Si un compte est supprimé, sa référence dans le journal devient vide, mais l'événement reste conservé.
- Les clés `PK`, `FK` et `UK` désignent respectivement une clé primaire, une clé étrangère et une valeur unique. Prisma utilise ces relations pour générer les requêtes SQL et le client TypeScript.

## Démarrage

1. Installer les dépendances : `npm install`.
2. Copier `.env.example` vers `.env`, puis configurer PostgreSQL, Resend et les secrets.
3. Appliquer le schéma et générer le client Prisma : `npm run db:migrate`, puis `npm run db:generate`.
4. Créer le premier super admin depuis l'environnement local : `npm run create:superadmin`.
5. Démarrer l'API : `npm run dev` (développement) ou `npm start`.

La commande `create:superadmin` lit `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` et `SUPER_ADMIN_NAME`. Elle refuse d'écraser un compte existant. Il n'existe aucune route publique d'inscription ni de promotion en super admin.

`JWT_ACCESS_SECRET` est obligatoire et doit faire au moins 32 caractères. Dans un environnement de production, utilisez une valeur aléatoire gardée hors du dépôt. `EMAIL_FROM` doit correspondre à un expéditeur autorisé sur Resend. L'API envoie les mails avec `POST https://api.resend.com/emails`.

## Parcours de création et connexion

1. Le super admin appelle `POST /admin/users`, en donnant l'adresse, le nom et un rôle `ADMIN`, `AGENT` ou `USER`.
2. L'API crée le compte en état `INVITED`, génère un mot de passe temporaire aléatoire et l'envoie par e-mail. Il expire après 7 jours et est stocké uniquement sous forme de hash.
3. La personne appelle `POST /auth/accept-invitation` avec l'adresse, le mot de passe temporaire et son nouveau mot de passe (12 caractères minimum). Le mot de passe temporaire ne peut être utilisé qu'une fois.
4. La personne se connecte avec `POST /auth/login`. La réponse contient un access token et un refresh token.

Si Resend échoue pendant la création, le compte reste en attente et la réponse indique `invitationEmailSent: false`. Après correction de la configuration, le super admin peut appeler `POST /admin/users/:id/resend-invitation`; cela invalide le mot de passe temporaire précédent.

### Exemple de création par le super admin

```http
POST /admin/users
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "email": "agent@example.com",
  "name": "Samira Agent",
  "role": "AGENT"
}
```

### Accepter l'invitation puis se connecter

```http
POST /auth/accept-invitation
Content-Type: application/json

{
  "email": "agent@example.com",
  "temporaryPassword": "<mot-de-passe-reçu-par-mail>",
  "password": "Mon nouveau mot de passe fort"
}
```

```http
POST /auth/login
Content-Type: application/json

{
  "email": "agent@example.com",
  "password": "Mon nouveau mot de passe fort"
}
```

Pour les routes protégées, envoyer `Authorization: Bearer <accessToken>`.

## Endpoints d'authentification

| Méthode | Endpoint | Accès | Fonction |
|---|---|---|---|
| POST | `/auth/accept-invitation` | Public, avec mot de passe temporaire | Activer le compte et choisir un mot de passe |
| POST | `/auth/login` | Public | Connexion par e-mail et mot de passe |
| POST | `/auth/refresh` | Public, avec refresh token | Révoquer l'ancien refresh token et en émettre un nouveau |
| POST | `/auth/logout` | Public, avec refresh token | Révoquer le refresh token fourni |
| POST | `/auth/forgot-password` | Public | Envoyer un jeton de récupération par e-mail |
| POST | `/auth/reset-password` | Public, avec jeton de récupération | Changer le mot de passe avec un jeton à usage unique |
| PATCH | `/auth/password` | Connecté | Changer son mot de passe actuel |
| GET | `/auth/me` | Connecté | Lire son compte |

Le mail de récupération fournit un jeton valable 30 minutes. L'API ne révèle pas si une adresse existe dans la réponse de `forgot-password`. Après une récupération, tous les refresh tokens du compte sont révoqués.

### Renouvellement des tokens

```http
POST /auth/refresh
Content-Type: application/json

{ "refreshToken": "<refreshToken-actuel>" }
```

La réponse contient un nouvel access token et un nouveau refresh token. Le refresh token présenté est consommé : le client doit remplacer immédiatement les deux valeurs qu'il conserve. Un token déjà consommé ou révoqué ne peut pas être réutilisé.

## Comment fonctionnent les tokens

- **Access token** : JWT signé en HS256, durée par défaut de 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`). Le client le met dans l'en-tête `Authorization: Bearer ...`. Il sert à prouver l'identité sur les routes protégées. Son contenu n'est pas chiffré : ne pas y mettre de secret.
- **Refresh token** : chaîne aléatoire opaque, durée par défaut de 30 jours (`REFRESH_TOKEN_TTL_DAYS`). Seul son hash SHA-256 est enregistré en base. Il sert uniquement à obtenir une nouvelle paire de tokens et à fermer la session.
- **Rotation** : chaque appel à `/auth/refresh` révoque le refresh token reçu et crée son successeur. Si deux requêtes tentent de réutiliser le même token, une seule peut réussir; le client doit éviter les renouvellements concurrents.
- **Déconnexion** : `/auth/logout` révoque le refresh token reçu. Le JWT déjà émis reste utilisable jusqu'à son expiration, au plus 15 minutes par défaut; le client doit aussi supprimer ses tokens locaux. Un compte désactivé est bloqué immédiatement, car le middleware vérifie son état et sa version de session en base à chaque requête. La désactivation et un changement de mot de passe invalident aussi les anciens access tokens.

Les mots de passe et mots de passe temporaires sont hachés avec `scrypt`; les jetons de récupération ne sont stockés qu'en hash. Un changement ou une récupération de mot de passe révoque les refresh tokens existants.

## Rôles et autorisations

| Rôle | Autorisations |
|---|---|
| `SUPER_ADMIN` | Créer et lister les comptes, renvoyer les invitations, activer ou désactiver les comptes; toutes les opérations sur les tickets |
| `ADMIN` | Lire tous les tickets, changer leur statut et demander des brouillons IA |
| `AGENT` | Lire tous les tickets, changer leur statut et demander des brouillons IA |
| `USER` | Créer des tickets et consulter uniquement ses propres tickets |

La création et la gestion des utilisateurs sont réservées au super admin. Il est créé par la commande locale d'initialisation. `ADMIN`, `AGENT` et `USER` ne peuvent pas appeler les routes `/admin`. Tous les endpoints `/tickets` demandent un access token valide.

### Comptes utilisateurs (super admin)

| Méthode | Endpoint | Fonction |
|---|---|---|
| GET | `/admin/users` | Lister les comptes sans exposer les hashes |
| POST | `/admin/users` | Créer et inviter un compte `ADMIN`, `AGENT` ou `USER` |
| POST | `/admin/users/:id/resend-invitation` | Remplacer le mot de passe temporaire et renvoyer l'invitation |
| PATCH | `/admin/users/:id/status` | Désactiver (`DISABLED`) ou réactiver (`ACTIVE`) un compte activé |
| PATCH | `/admin/users/:id/role` | Changer le rôle, révoquer les sessions et écrire un événement d'audit |
| GET | `/admin/audit-logs` | Consulter les actions sensibles enregistrées |

La désactivation révoque les refresh tokens, les jetons de récupération en attente et les access tokens existants. La réactivation ne restaure aucune ancienne session; l'utilisateur se reconnecte avec son mot de passe.

## Tickets

| Méthode | Endpoint | Autorisation |
|---|---|---|
| GET | `/tickets` | Tout compte actif; un `USER` reçoit uniquement ses tickets |
| POST | `/tickets` | Tout compte actif; le ticket est lié au compte connecté |
| GET | `/tickets/:id` | Tout compte actif; un `USER` ne voit que ses tickets, le support voit aussi le dernier brouillon IA |
| GET | `/tickets/:id/comments` | Propriétaire `USER` uniquement; historique chronologique de la conversation |
| POST | `/tickets/:id/comments` | Propriétaire `USER` uniquement; ajoute un commentaire et crée une réponse IA |
| PATCH | `/tickets/:id/status` | `SUPER_ADMIN`, `ADMIN` ou `AGENT` |
| POST | `/tickets/:id/ai-response` | `SUPER_ADMIN`, `ADMIN` ou `AGENT`; enregistre un brouillon IA sans l'envoyer |

Statuts autorisés : `open`, `in_progress`, `closed`.

### Pagination, filtres et tri

`GET /tickets` accepte `page`, `limit`, `status`, `category`, `q`, `sortBy` et `order`. Exemple : `GET /tickets?page=1&limit=10&status=open&category=AUTHENTICATION&q=connexion&sortBy=createdAt&order=desc`. Les critères peuvent être combinés. Zod vérifie les valeurs et le service filtre les tickets dans Prisma. Un rôle `USER` ne peut toujours voir que ses propres tickets, même lorsqu'il utilise des filtres.

La création exige une catégorie technique dans le JSON, par exemple `"category": "AUTHENTICATION"`. Les valeurs stockées sont en anglais; l'application cliente affiche les libellés français correspondants : `AUTHENTICATION` → « Authentification », `DISPLAY` → « Affichage », `PERFORMANCE` → « Performance », `NETWORK` → « Réseau », `BUG` → « Bug », `PAYMENT` → « Paiement / facturation », `ACCOUNT` → « Compte / profil » et `OTHER` → « Autre ». L'API ne contient pas d'interface utilisateur; c'est au client de présenter ces libellés.

La réponse est enveloppée de façon commune : les données sont dans `data`, et les informations de pagination dans `meta`.

```json
{
  "data": [{ "id": "550e8400-e29b-41d4-a716-446655440000", "title": "Problème de connexion", "category": "AUTHENTICATION", "status": "open" }],
  "meta": { "page": 2, "limit": 10, "totalItems": 11, "totalPages": 2 }
}
```

### Brouillon de réponse assisté par IA

Le technicien appelle `POST /tickets/:id/ai-response` avec son access token. L'API envoie au modèle uniquement le titre, la description, la catégorie et le statut du ticket; elle n'envoie pas l'identité ou l'e-mail du créateur. La réponse structurée est validée par Zod puis enregistrée dans `TicketAiDraft`. Le résultat reste un brouillon : aucun e-mail n'est envoyé et le statut du ticket n'est pas modifié. Les requêtes sont limitées à 10 par IP sur 15 minutes. La requête utilise `store: false` pour ne pas conserver l'état de la réponse OpenAI ; les règles de journalisation anti-abus du fournisseur restent distinctes.

`GET /tickets/:id` inclut uniquement le texte proposé au client dans `data.customer_response` pour les rôles `SUPER_ADMIN`, `ADMIN` et `AGENT`. Les autres informations internes du brouillon IA ne sont pas renvoyées. Le compte `USER` ne reçoit pas ce texte tant qu'un technicien ne l'a pas validé.

### Conversation utilisateur avec l'IA

La conversation est stockée dans `Comment`, séparément de `TicketAiDraft`. La première réponse IA est générée après le premier commentaire, pas lors de la création du ticket. L'historique est transmis dans l'ordre chronologique avec les messages `USER` comme messages utilisateur et les messages `AI` comme réponses précédentes de l'assistant. Seul le propriétaire ayant le rôle `USER` peut lire ou commenter cette conversation. Un ticket fermé refuse les nouveaux commentaires; un ticket accepte au maximum 20 commentaires `USER`. Les réponses IA ne comptent pas dans cette limite.

```http
POST /tickets/550e8400-e29b-41d4-a716-446655440000/comments
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{ "content": "J'ai redémarré l'application, mais le problème continue." }
```

En cas de succès, `data.userComment` contient le message et `data.aiReply` la réponse. `GET /tickets/550e8400-e29b-41d4-a716-446655440000/comments` permet ensuite de lire tout l'historique. Les deux endpoints sont testables dans Postman; aucun identifiant d'auteur ne doit être envoyé dans le body.

Cette fonctionnalité ne prend volontairement pas en charge `Idempotency-Key`. Si un client répète le même POST après que la première requête est terminée, le backend ne peut pas savoir qu'il s'agit d'une répétition : il peut créer un second commentaire et refaire un appel OpenAI. La limite de génération simultanée empêche deux générations actives à la fois, mais elle ne supprime pas ce risque après la fin d'une requête. C'est une limite de fiabilité à documenter dans le rapport.

Si le processus Node.js s'arrête pendant un appel OpenAI, le commentaire utilisateur peut rester à l'état `PROCESSING`. Aucun worker ni mécanisme automatique de récupération n'est installé; une stratégie de reprise devra être décidée séparément.

Configure `OPENAI_API_KEY` uniquement dans le `.env` local et ajuste `OPENAI_MODEL` si nécessaire. Le `.env` est ignoré par Git. Les tests utilisent un faux client : ils ne contactent pas OpenAI et ne consomment pas de crédits. L'IA peut se tromper; un technicien doit vérifier le brouillon avant de l'utiliser.

## Sécurité, erreurs et journal d'audit

- Les erreurs utilisent le même format `{ "error": { "code", "message", "details?" }, "requestId" }`. Le `requestId` est aussi dans l'en-tête `X-Request-Id`; le serveur le met dans ses journaux pour diagnostiquer une erreur 500 sans envoyer sa stack trace au client.
- Zod valide les corps JSON, paramètres d'URL et paramètres de recherche avant les contrôleurs. Prisma construit les requêtes SQL avec des paramètres; le projet ne concatène pas des valeurs utilisateur dans du SQL brut.
- Une limite générale bloque les excès de requêtes. La connexion est limitée à 10 tentatives par IP sur 15 minutes et l'envoi de récupération à 5 demandes par heure. Le limiteur en mémoire convient à une seule instance locale; une production avec plusieurs instances devra utiliser un stockage partagé.
- La génération IA a sa propre limite par IP; les erreurs du fournisseur sont converties en erreurs API génériques pour ne pas exposer les détails internes.
- `PATCH /admin/users/:id/role` permet au super admin de changer un rôle. Le changement, la révocation des sessions, et le journal d'audit sont faits ensemble dans une transaction.
- `PATCH /admin/users/:id/status` journalise la désactivation et la réactivation et révoque les sessions lors d'une désactivation. `GET /admin/audit-logs` permet au super admin de consulter le journal paginé.

## Documentation OpenAPI et intégration continue

- La description OpenAPI est disponible à `GET /openapi.json`. Télécharge cette spécification ou ouvre son URL avec Swagger Editor / Swagger UI pour parcourir les routes et essayer les requêtes.
- GitHub Actions lance `npm ci`, génère Prisma, applique les migrations sur une base PostgreSQL temporaire, vérifie les types puis lance les tests à chaque push et pull request.

Pour lancer tous les tests en local, crée une base PostgreSQL réservée aux tests (par exemple `createdb support_tickets_test`) puis renseigne `TEST_DATABASE_URL` dans `.env`. Les tests refusent de démarrer sans cette variable pour éviter d'effacer des données de développement. Les tests unitaires seuls se lancent avec `npm run test:unit` et ne demandent pas PostgreSQL.

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:motdepasse@localhost:5432/support_tickets_test?schema=public"
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:deploy
npm test
```

Les tests couvrent la validation, l'authentification, les rôles, l'accès et la catégorisation des tickets, les brouillons IA avec un faux générateur, la pagination, les audits, le format des erreurs, la limitation des tentatives et le hachage de mot de passe.

## Vérification de l'e-mail Resend

Configurez `RESEND_API_KEY` et `EMAIL_FROM` dans `.env`. Resend exige un expéditeur/domaine autorisé pour l'envoi. Si l'envoi échoue, l'API journalise l'erreur sans renvoyer de secret au client; les invitations peuvent être renvoyées par le super admin.
