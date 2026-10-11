import { readFile } from "node:fs/promises";
import { createTransport } from "nodemailer";
import path from "node:path";
import handlebars from "handlebars";

const transporter = createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
});

export const sendMail = async ({
  to,
  subject,
  templateName,
  context,
}: {
  to: string;
  subject: string;
  templateName: string;
  context: object;
}) => {
  const templatePath = path.join(__dirname, "../templates", templateName);
  const templateSource = await readFile(templatePath, "utf-8");
  const html = handlebars.compile(templateSource)(context);

  await transporter.sendMail({
    to: to,
    subject: subject,
    html: html,
  });
};
