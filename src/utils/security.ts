import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";

import type { Role } from "@prisma/client";

// La clé de signature est chargée depuis l'environnement et doit être longue :
// sans elle, le serveur ne doit pas démarrer avec des JWT faciles à falsifier.
const accessSecret = process.env.JWT_ACCESS_SECRET;
if (!accessSecret || accessSecret.length < 32) {
  throw new Error("JWT_ACCESS_SECRET doit contenir au moins 32 caractères.");
}

const secondsFromEnv = (key: string, fallback: number): number => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} doit être un nombre positif.`);
  }
  return Math.floor(value);
};

export const ACCESS_TOKEN_TTL_SECONDS = secondsFromEnv(
  "ACCESS_TOKEN_TTL_SECONDS",
  15 * 60,
);
export const REFRESH_TOKEN_TTL_DAYS = secondsFromEnv(
  "REFRESH_TOKEN_TTL_DAYS",
  30,
);

// scrypt ralentit les essais massifs de mots de passe volés. Chaque mot de passe
// reçoit aussi un sel aléatoire, conservé avec le hash pour pouvoir le vérifier.
const scrypt = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, saltText, hashText] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  const expected = Buffer.from(hashText, "base64url");
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"));
  // timingSafeEqual évite une comparaison dont la durée varierait selon le préfixe
  // correct du hash, ce qui limiterait certaines fuites d'information temporelles.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Un token opaque est un secret aléatoire sans données lisibles à l'intérieur.
export const createOpaqueToken = (): string => randomBytes(32).toString("base64url");

// On conserve seulement une empreinte du token en base : si la base fuit, le secret
// original ne peut pas être relu directement.
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

type AccessClaims = {
  // sub = identifiant du compte; exp = date d'expiration; ver = version de session.
  sub: string;
  email: string;
  role: Role;
  iat: number;
  exp: number;
  jti: string;
  ver: number;
};

const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function createAccessToken(user: {
  id: string;
  email: string;
  role: Role;
  tokenVersion: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  // Le payload est encodé, pas chiffré : il ne faut jamais y mettre de secret.
  // La signature HS256 permet ensuite au serveur de détecter toute modification.
  const payload = encode({
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomBytes(16).toString("hex"),
    ver: user.tokenVersion,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", accessSecret!)
    .update(unsignedToken)
    .digest("base64url");
  return `${unsignedToken}.${signature}`;
}

export function verifyAccessToken(token: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerText, payloadText, signatureText] = parts;
  if (!headerText || !payloadText || !signatureText) return null;

  try {
    const header = JSON.parse(
      Buffer.from(headerText, "base64url").toString("utf8"),
    ) as { alg?: string; typ?: string };
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;

    // Recalcule la signature à partir du contenu reçu et compare en temps constant.
    const expectedSignature = createHmac("sha256", accessSecret!)
      .update(`${headerText}.${payloadText}`)
      .digest();
    const actualSignature = Buffer.from(signatureText, "base64url");
    if (
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      return null;
    }

    const claims = JSON.parse(
      Buffer.from(payloadText, "base64url").toString("utf8"),
    ) as Partial<AccessClaims>;
    const validRoles: Role[] = ["SUPER_ADMIN", "ADMIN", "AGENT", "USER"];
    if (
      typeof claims.sub !== "string" ||
      typeof claims.email !== "string" ||
      !validRoles.includes(claims.role as Role) ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(Date.now() / 1000) ||
      typeof claims.iat !== "number" ||
      typeof claims.jti !== "string" ||
      typeof claims.ver !== "number"
    ) {
      return null;
    }
    return claims as AccessClaims;
  } catch {
    return null;
  }
}

export function passwordIsValid(password: unknown): password is string {
  // Cette vérification sert aussi au script de création du premier super-admin.
  return typeof password === "string" && password.length >= 12 && password.length <= 128;
}

export const expiresInDays = (days: number): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);
