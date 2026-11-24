export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Simulated email: real sending is still to be decided (especificaciones §9). Meanwhile
 * the message, with its links, is written to the server console so the verification and
 * password reset flows can be tested by hand.
 */
export async function sendEmail(email: Email): Promise<void> {
  console.info(
    ["", "──── Email (simulado) ────", `Para: ${email.to}`, `Asunto: ${email.subject}`, "", email.text, "─".repeat(26)].join(
      "\n",
    ),
  );
  await Promise.resolve();
}
