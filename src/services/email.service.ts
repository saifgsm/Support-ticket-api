type SendEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const escapeHtml = (value: string): string =>
  // Les valeurs injectées dans le HTML d'un e-mail sont échappées pour qu'un nom
  // ou un token ne puisse pas être interprété comme du code HTML.
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export async function sendEmail(email: SendEmail): Promise<void> {
  // Les secrets restent côté serveur dans .env; ils ne sont jamais demandés au client.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY et EMAIL_FROM doivent être configurés.");
  }

  // Le serveur appelle l'API Resend avec sa clé secrète et un corps JSON.
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend a refusé l'envoi (${response.status}): ${details}`);
  }
}

export async function sendInvitationEmail(
  email: string,
  name: string,
  temporaryPassword: string,
): Promise<void> {
  const safeName = escapeHtml(name);
  const safePassword = escapeHtml(temporaryPassword);
  const endpoint = `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/auth/accept-invitation`;
  await sendEmail({
    to: email,
    subject: "Votre invitation à Support Ticket API",
    text: `Bonjour ${name},\n\nVotre compte a été créé. Mot de passe temporaire : ${temporaryPassword}\n\nPour activer le compte, appelez POST ${endpoint} avec votre email, le mot de passe temporaire et votre nouveau mot de passe (12 caractères minimum). Ce mot de passe temporaire expire dans 7 jours et ne peut être utilisé qu'une fois.`,
    html: `<p>Bonjour ${safeName},</p><p>Votre compte Support Ticket API a été créé.</p><p>Mot de passe temporaire : <strong>${safePassword}</strong></p><p>Pour activer votre compte, appelez <code>POST ${escapeHtml(endpoint)}</code> avec votre adresse e-mail, ce mot de passe temporaire et le nouveau mot de passe de votre choix (12 caractères minimum).</p><p>Le mot de passe temporaire expire dans 7 jours et ne peut être utilisé qu'une fois.</p>`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  name: string,
  token: string,
): Promise<void> {
  const safeName = escapeHtml(name);
  const safeToken = escapeHtml(token);
  const endpoint = `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/auth/reset-password`;
  await sendEmail({
    to: email,
    subject: "Réinitialisation de votre mot de passe",
    text: `Bonjour ${name},\n\nVotre jeton de réinitialisation (valable 30 minutes et à usage unique) : ${token}\n\nAppelez POST ${endpoint} avec votre email, ce jeton et votre nouveau mot de passe. Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.`,
    html: `<p>Bonjour ${safeName},</p><p>Votre jeton de réinitialisation est valable 30 minutes et à usage unique :</p><p><code>${safeToken}</code></p><p>Appelez <code>POST ${escapeHtml(endpoint)}</code> avec votre e-mail, ce jeton et votre nouveau mot de passe. Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.</p>`,
  });
}
