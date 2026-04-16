// Gmail integration via Replit connector (google-mail)
import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getUncachableGmailClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export async function sendEmail(to: string, subject: string, body: string, cc?: string, html?: string): Promise<void> {
  const gmail = await getUncachableGmailClient();

  const toAddresses = to.split(/[,;]\s*/).map(e => e.trim()).filter(Boolean).join(", ");
  const ccAddresses = cc ? cc.split(/[,;]\s*/).map(e => e.trim()).filter(Boolean).join(", ") : "";
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

  let rawMessage: string;

  if (html) {
    const boundary = `boundary_${Date.now()}`;
    const headers = [
      `From: Formic Support <support@formic.co>`,
      `To: ${toAddresses}`,
      ...(ccAddresses ? [`Cc: ${ccAddresses}`] : []),
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].join('\r\n');

    const textPart = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(body, 'utf-8').toString('base64'),
    ].join('\r\n');

    const htmlPart = [
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(html, 'utf-8').toString('base64'),
      `--${boundary}--`,
    ].join('\r\n');

    rawMessage = `${headers}\r\n\r\n${textPart}\r\n${htmlPart}`;
  } else {
    const headers = [
      `From: Formic Support <support@formic.co>`,
      `To: ${toAddresses}`,
      ...(ccAddresses ? [`Cc: ${ccAddresses}`] : []),
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
    ].join('\r\n');
    rawMessage = `${headers}\r\n\r\n${Buffer.from(body, 'utf-8').toString('base64')}`;
  }

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
}
