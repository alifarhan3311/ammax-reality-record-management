import nodemailer from 'nodemailer';

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function sendEmail({ to, subject, html }) {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s/g, '');
  const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true';
  const from = process.env.EMAIL_FROM?.trim() || `AMMAX Records <${user}>`;
  if (!user || !pass) return { skipped: true, reason: 'Gmail SMTP is not configured' };
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
  return transporter.sendMail({ from, to, subject, html });
}

export const checklistChangesEmail = ({ agentName, transaction, changes }) => {
  const appUrl = (process.env.APP_URL || 'http://localhost:5050').replace(/\/$/, '');
  const rows = changes.map(change => `<tr><td style="padding:8px;border:1px solid #ddd">${escapeHtml(change.documentation)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(change.from)}</td><td style="padding:8px;border:1px solid #ddd"><strong>${escapeHtml(change.to)}</strong></td></tr>`).join('');
  return {
    subject: `Checklist updated — Deal ${transaction.dealNumber || ''}`,
    html: `<p>Hello ${escapeHtml(agentName)},</p><p>An administrator updated checklist statuses for <strong>${escapeHtml(transaction.address)}</strong>.</p><table style="border-collapse:collapse"><tr><th style="padding:8px;border:1px solid #ddd">Document</th><th style="padding:8px;border:1px solid #ddd">Previous</th><th style="padding:8px;border:1px solid #ddd">New</th></tr>${rows}</table><p><a href="${appUrl}/transactions/${transaction._id}">Open transaction</a></p>`
  };
};

export const dailyReminderEmail = ({ agentName, items }) => {
  const appUrl = (process.env.APP_URL || 'http://localhost:5050').replace(/\/$/, '');
  const rows = items.map(item => `<tr><td style="padding:8px;border:1px solid #ddd">${escapeHtml(item.address)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(item.documentation)}</td><td style="padding:8px;border:1px solid #ddd"><strong>${escapeHtml(item.status)}</strong></td><td style="padding:8px;border:1px solid #ddd"><a href="${appUrl}/transactions/${item.transactionId}">Open</a></td></tr>`).join('');
  return { subject: 'AMMAX daily checklist reminders', html: `<p>Hello ${escapeHtml(agentName)},</p><p>The following checklist items still require attention:</p><table style="border-collapse:collapse"><tr><th style="padding:8px;border:1px solid #ddd">Transaction</th><th style="padding:8px;border:1px solid #ddd">Document</th><th style="padding:8px;border:1px solid #ddd">Status</th><th style="padding:8px;border:1px solid #ddd">Link</th></tr>${rows}</table>` };
};
