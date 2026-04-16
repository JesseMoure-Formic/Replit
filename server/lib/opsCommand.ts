const OPS_COMMAND_URL = "https://chief-of-insight.replit.app/api/external";
const SECRET = process.env.INTER_APP_SECRET;

function opsHeaders(): Record<string, string> {
  return { "Authorization": `Bearer ${SECRET}` };
}

export async function pingOpsCommand(): Promise<unknown> {
  const res = await fetch(`${OPS_COMMAND_URL}/ping`, { headers: opsHeaders() });
  return res.json();
}

export interface OncallPerson {
  name: string;
  [key: string]: unknown;
}

export interface OncallResponse {
  currentFse: OncallPerson;
  currentTech?: OncallPerson;
  currentRotationStartsAt?: string;
  nextRotationAt: string;
  nextWeekFse?: OncallPerson;
  nextWeekTech?: OncallPerson;
  [key: string]: unknown;
}

export async function getOncall(): Promise<OncallResponse> {
  const res = await fetch(`${OPS_COMMAND_URL}/oncall`, { headers: opsHeaders() });
  if (!res.ok) throw new Error(`Ops Command returned ${res.status}`);
  const data = await res.json();
  if (typeof data !== "object" || data === null) throw new Error("Invalid oncall response");
  return data as OncallResponse;
}
