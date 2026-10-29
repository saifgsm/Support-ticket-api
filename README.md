# Support Ticket API

**Auteur : Gouasmia Sifeddine**

## Description

Support Ticket API est une API REST développée avec Node.js, Express et TypeScript. Elle permet de gérer des tickets de support et de stocker les données dans une base de données PostgreSQL grâce à Prisma ORM.

## Fonctionnalités

- Créer un ticket de support.
- Récupérer la liste de tous les tickets.
- Récupérer un ticket par son identifiant.
- Modifier le statut d'un ticket.
- Valider les données reçues et gérer les erreurs courantes.

## Technologies utilisées

- **Node.js** — environnement d'exécution JavaScript.
- **Express.js** — création de l'API REST.
- **TypeScript** — typage statique.
- **PostgreSQL** — base de données relationnelle.
- **Prisma ORM** — accès à la base de données.

## Installation

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configurer la base de données

Créer une base de données PostgreSQL nommée `support_tickets`, puis configurer la variable `DATABASE_URL` dans le fichier `.env` :

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/support_tickets?schema=public"
```

Remplacer `YOUR_PASSWORD` par le mot de passe PostgreSQL.

### 3. Appliquer les migrations

```bash
npx prisma migrate dev
```

### 4. Générer le client Prisma

```bash
npx prisma generate
```

## Démarrer le serveur

```bash
npx tsx src/server.ts
```

L'API sera accessible à l'adresse :

`http://localhost:3000`

## Endpoints de l'API

| Méthode | Endpoint | Description |
|---|---|---|
| POST | `/tickets` | Créer un ticket |
| GET | `/tickets` | Lister tous les tickets |
| GET | `/tickets/:id` | Récupérer un ticket par ID |
| PATCH | `/tickets/:id/status` | Modifier le statut d'un ticket |

## Exemple de création d'un ticket

**Requête :** `POST /tickets`

```json
{
  "title": "Problème de connexion",
  "description": "Impossible de se connecter à mon compte."
}
```

Le statut initial du ticket est `open`.

## Statuts disponibles

- `open` — ticket ouvert.
- `in_progress` — ticket en cours de traitement.
- `closed` — ticket fermé.

## Auteur

**Gouasmia Sifeddine**
