/** Spécification OpenAPI publiée par GET /openapi.json et ouvrable dans Swagger. */
const jsonResponse = (description: string, dataSchema?: unknown) => ({
  description,
  content: {
    "application/json": {
      schema: dataSchema
        ? {
            type: "object",
            required: ["data"],
            properties: {
              data: dataSchema,
              meta: { type: "object", description: "Métadonnées, par exemple la pagination." },
            },
          }
        : { $ref: "#/components/schemas/SuccessEnvelope" },
    },
  },
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Support Ticket API",
    version: "1.0.0",
    description: "API de gestion des comptes, de l'authentification et des tickets.",
  },
  servers: [{ url: "/", description: "Hôte courant de l'API" }],
  tags: [
    { name: "Auth", description: "Connexion, tokens et mots de passe" },
    { name: "Admin", description: "Comptes et journal d'audit (Super Admin)" },
    { name: "Tickets", description: "Tickets accessibles selon le rôle" },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Vérifier que l'API répond",
        responses: { "200": jsonResponse("API disponible") },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Se connecter avec e-mail et mot de passe",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } } } },
        responses: { "200": jsonResponse("Session créée"), "401": { $ref: "#/components/responses/Error" }, "429": { $ref: "#/components/responses/Error" } },
      },
    },
    "/auth/accept-invitation": {
      post: {
        tags: ["Auth"],
        summary: "Accepter une invitation et choisir un mot de passe",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AcceptInvitationInput" } } } },
        responses: { "200": jsonResponse("Compte activé"), "400": { $ref: "#/components/responses/Error" } },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Renouveler la session avec rotation du refresh token",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshInput" } } } },
        responses: { "200": jsonResponse("Nouveaux tokens"), "401": { $ref: "#/components/responses/Error" } },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Déconnecter le compte et révoquer ses sessions",
        description: "Requiert un access token Bearer valide. Invalide immédiatement les access tokens via tokenVersion et révoque tous les refresh tokens du compte.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshInput" } } } },
        responses: {
          "204": { description: "Sessions révoquées" },
          "401": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Demander un e-mail de récupération",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EmailInput" } } } },
        responses: { "200": jsonResponse("Réponse identique que l'adresse existe ou non"), "429": { $ref: "#/components/responses/Error" } },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Changer le mot de passe avec un jeton à usage unique",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordInput" } } } },
        responses: { "200": jsonResponse("Mot de passe modifié"), "400": { $ref: "#/components/responses/Error" } },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Lire le compte connecté",
        security: [{ bearerAuth: [] }],
        responses: { "200": jsonResponse("Compte courant"), "401": { $ref: "#/components/responses/Error" } },
      },
    },
    "/auth/password": {
      patch: {
        tags: ["Auth"],
        summary: "Changer le mot de passe connecté",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ChangePasswordInput" } } } },
        responses: { "200": jsonResponse("Mot de passe modifié et session renouvelée"), "401": { $ref: "#/components/responses/Error" } },
      },
    },
    "/admin/users": {
      get: {
        tags: ["Admin"], summary: "Lister les comptes", security: [{ bearerAuth: [] }],
        responses: { "200": jsonResponse("Comptes sans hash des mots de passe"), "403": { $ref: "#/components/responses/Error" } },
      },
      post: {
        tags: ["Admin"], summary: "Créer et inviter un compte", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateUserInput" } } } },
        responses: { "201": jsonResponse("Compte créé"), "403": { $ref: "#/components/responses/Error" } },
      },
    },
    "/admin/users/{id}/resend-invitation": {
      post: {
        tags: ["Admin"], summary: "Renvoyer une invitation", security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: { "200": jsonResponse("Invitation renvoyée"), "404": { $ref: "#/components/responses/Error" } },
      },
    },
    "/admin/users/{id}/status": {
      patch: {
        tags: ["Admin"], summary: "Désactiver ou réactiver un compte", security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateStatusInput" } } } },
        responses: { "200": jsonResponse("État modifié; action inscrite à l'audit"), "403": { $ref: "#/components/responses/Error" } },
      },
    },
    "/admin/users/{id}/role": {
      patch: {
        tags: ["Admin"], summary: "Modifier le rôle d'un compte", security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateRoleInput" } } } },
        responses: { "200": jsonResponse("Rôle modifié; anciennes sessions révoquées et action auditée"), "403": { $ref: "#/components/responses/Error" } },
      },
    },
    "/admin/audit-logs": {
      get: {
        tags: ["Admin"], summary: "Consulter les actions sensibles", security: [{ bearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { "200": jsonResponse("Journal d'audit paginé"), "403": { $ref: "#/components/responses/Error" } },
      },
    },
    "/tickets": {
      get: {
        tags: ["Tickets"], summary: "Lister, filtrer, trier et paginer les tickets", security: [{ bearerAuth: [] }],
        description: "Pour USER, les éléments ne contiennent pas createdById ni de données de brouillon IA internes. La lecture détaillée expose uniquement customer_response.",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["open", "in_progress", "closed"] } },
          { name: "category", in: "query", description: "Filtre par catégorie technique du ticket", schema: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] } },
          { name: "q", in: "query", description: "Recherche dans le titre et la description", schema: { type: "string", maxLength: 100 } },
          { name: "sortBy", in: "query", schema: { type: "string", enum: ["createdAt", "title", "status"], default: "createdAt" } },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
        ],
        responses: {
          "200": jsonResponse("Page de tickets et métadonnées de pagination", {
            type: "array",
            items: { oneOf: [{ $ref: "#/components/schemas/TicketStaffSummary" }, { $ref: "#/components/schemas/TicketUserSummary" }] },
          }),
          "401": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["Tickets"], summary: "Créer un ticket pour le compte connecté", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTicketInput" } } } },
        responses: {
          "201": jsonResponse("Ticket créé", {
            oneOf: [{ $ref: "#/components/schemas/TicketStaffSummary" }, { $ref: "#/components/schemas/TicketUserSummary" }],
          }),
          "400": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/tickets/{id}/ai-response": {
      post: {
        tags: ["Tickets"],
        summary: "Générer et enregistrer une réponse IA",
        description: "Accessible à SUPER_ADMIN, ADMIN et AGENT; un USER peut l'utiliser uniquement pour son propre ticket. Le brouillon complet est conservé en base. La réponse USER est filtrée et contient seulement id, ticketId et response.customer_response. Aucun e-mail n'est envoyé et le statut du ticket n'est pas modifié.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "201": jsonResponse("Brouillon IA enregistré; réponse filtrée pour USER", {
            oneOf: [{ $ref: "#/components/schemas/TicketAiDraft" }, { $ref: "#/components/schemas/TicketAiDraftUserView" }],
          }),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "429": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
          "504": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/tickets/{id}/comments": {
      get: {
        tags: ["Tickets"],
        summary: "Lire la conversation du ticket (propriétaire USER uniquement)",
        description: "Renvoie les commentaires USER et AI dans l'ordre chronologique. Les comptes support n'ont pas accès à cette conversation.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": jsonResponse("Commentaires dans l'ordre chronologique"),
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["Tickets"],
        summary: "Ajouter un commentaire et obtenir une réponse IA",
        description: "Réservé au propriétaire USER d'un ticket ouvert. Maximum 20 commentaires USER par ticket, 20 générations IA par compte USER sur une fenêtre de 15 minutes et une génération IA à la fois. Cette opération n'utilise pas de clé d'idempotence : une répétition après la fin de la première opération peut créer un doublon et un nouvel appel IA.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTicketCommentInput" } } },
        },
        responses: {
          "201": jsonResponse("Commentaire USER et réponse AI enregistrés"),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "429": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
          "504": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/tickets/{id}": {
      get: {
        tags: ["Tickets"],
        summary: "Lire un ticket accessible au compte",
        description: "USER reçoit les champs du ticket nécessaires à son suivi, sans createdById ni contenu interne du brouillon IA, ainsi que le seul champ customer_response. Les rôles support reçoivent le ticket et customer_response.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": jsonResponse("Ticket filtré selon le rôle", {
            oneOf: [{ $ref: "#/components/schemas/TicketStaffView" }, { $ref: "#/components/schemas/TicketUserView" }],
          }),
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/tickets/{id}/status": {
      patch: {
        tags: ["Tickets"], summary: "Modifier l'état d'un ticket (support)", security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTicketStatusInput" } } } },
        responses: { "200": jsonResponse("Ticket mis à jour"), "403": { $ref: "#/components/responses/Error" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token obtenu par POST /auth/login" },
    },
    parameters: {
      UserId: { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } },
    },
    responses: {
      Error: {
        description: "Erreur uniforme de l'API",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
      },
    },
    schemas: {
      SuccessEnvelope: {
        type: "object",
        required: ["data"],
        properties: {
          data: { description: "Résultat de la requête; objet ou liste selon l'endpoint." },
          meta: { type: "object", description: "Métadonnées, par exemple la pagination." },
        },
      },
      ApiError: {
        type: "object", required: ["error", "requestId"],
        properties: {
          error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object" } } },
          requestId: { type: "string", format: "uuid" },
        },
      },
      EmailInput: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } },
      LoginInput: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } },
      AcceptInvitationInput: { type: "object", required: ["email", "temporaryPassword", "password"], properties: { email: { type: "string", format: "email" }, temporaryPassword: { type: "string" }, password: { type: "string", minLength: 12, maxLength: 128 } } },
      RefreshInput: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } },
      ResetPasswordInput: { type: "object", required: ["email", "token", "password"], properties: { email: { type: "string", format: "email" }, token: { type: "string" }, password: { type: "string", minLength: 12, maxLength: 128 } } },
      ChangePasswordInput: { type: "object", required: ["currentPassword", "newPassword"], properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 12, maxLength: 128 } } },
      CreateUserInput: { type: "object", required: ["email", "name", "role"], properties: { email: { type: "string", format: "email" }, name: { type: "string", minLength: 1, maxLength: 120 }, role: { type: "string", enum: ["ADMIN", "AGENT", "USER"] } } },
      UpdateStatusInput: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["ACTIVE", "DISABLED"] } } },
      UpdateRoleInput: { type: "object", required: ["role"], properties: { role: { type: "string", enum: ["ADMIN", "AGENT", "USER"] } } },
      CreateTicketInput: { type: "object", required: ["title", "description", "category"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, description: { type: "string", minLength: 1, maxLength: 10000 }, category: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] } } },
      CreateTicketCommentInput: { type: "object", required: ["content"], properties: { content: { type: "string", minLength: 1, maxLength: 4000, description: "Texte du commentaire utilisateur" } } },
      TicketComment: {
        type: "object",
        required: ["id", "content", "type", "createdAt", "aiStatus"],
        properties: {
          id: { type: "string" },
          content: { type: "string" },
          type: { type: "string", enum: ["USER", "AI"] },
          createdAt: { type: "string", format: "date-time" },
          aiStatus: { type: ["string", "null"], enum: ["PROCESSING", "COMPLETED", "FAILED", null] },
        },
      },
      TicketCommentExchange: {
        type: "object",
        required: ["userComment", "aiReply"],
        properties: {
          userComment: { $ref: "#/components/schemas/TicketComment" },
          aiReply: { $ref: "#/components/schemas/TicketComment" },
        },
      },
      UpdateTicketStatusInput: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["open", "in_progress", "closed"] } } },
      TicketAiResponse: {
        type: "object",
        required: ["is_it_related", "category", "summary", "possible_cause", "resolution_steps", "customer_response", "needs_more_information", "needs_human"],
        properties: {
          is_it_related: { type: "boolean" },
          category: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] },
          summary: { type: "string" },
          possible_cause: { type: ["string", "null"] },
          resolution_steps: { type: "array", items: { type: "string" } },
          customer_response: { type: "string" },
          needs_more_information: { type: "boolean" },
          needs_human: { type: "boolean" },
        },
      },
      TicketAiDraft: {
        type: "object",
        required: ["id", "ticketId", "generatedById", "model", "response", "createdAt"],
        properties: {
          id: { type: "string" },
          ticketId: { type: "string", format: "uuid" },
          generatedById: { type: ["string", "null"] },
          model: { type: "string" },
          response: { $ref: "#/components/schemas/TicketAiResponse" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TicketAiDraftUserView: {
        type: "object",
        additionalProperties: false,
        required: ["id", "ticketId", "response"],
        properties: {
          id: { type: "string", description: "Identifiant du brouillon" },
          ticketId: { type: "string", format: "uuid" },
          response: {
            type: "object",
            additionalProperties: false,
            required: ["customer_response"],
            properties: { customer_response: { type: "string" } },
          },
        },
      },
      TicketStaffSummary: {
        type: "object",
        required: ["id", "title", "description", "category", "status", "createdAt", "createdById"],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          createdById: { type: ["string", "null"] },
        },
      },
      TicketUserSummary: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "category", "status", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TicketStaffView: {
        type: "object",
        required: ["id", "title", "description", "category", "status", "createdAt", "createdById", "customer_response"],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          createdById: { type: ["string", "null"] },
          customer_response: { type: ["string", "null"] },
        },
      },
      TicketUserView: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "category", "status", "createdAt", "customer_response"],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["AUTHENTICATION", "DISPLAY", "PERFORMANCE", "NETWORK", "BUG", "PAYMENT", "ACCOUNT", "OTHER"] },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          customer_response: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;
