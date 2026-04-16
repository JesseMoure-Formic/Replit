import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-haiku-4-5";

function getText(response: Anthropic.Message): string {
  const block = response.content[0];
  return block?.type === "text" ? block.text.trim() : "";
}

export async function generateTitleSummary(description: string): Promise<string> {
  if (!description || description === "No description") {
    return "Untitled Ticket";
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 30,
      system:
        "You are a concise ticket title generator. Given a support ticket description, produce a short title (5-10 words max) that captures the core issue. Return only the title text, no quotes or punctuation at the end.",
      messages: [{ role: "user", content: description.slice(0, 500) }],
    });

    return getText(response) || "Untitled Ticket";
  } catch (err) {
    console.error("AI summary generation failed:", err);
    return description.slice(0, 60) + (description.length > 60 ? "..." : "");
  }
}

export async function generateCloseTicketFields(
  rawText: string,
  context?: { ticketTitle?: string; customerName?: string; description?: string }
): Promise<{ determination: string; solution: string }> {
  if (!rawText?.trim()) throw new Error("No text provided");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const systemPrompt = [
    "You are a professional field-service ticket writer for Formic Technologies, a robotics automation company.",
    `Today's date is ${today}.`,
    "The user will describe in plain English how a service issue was resolved.",
    "You must produce exactly two short, professional statements and return them as valid JSON:",
    '{ "determination": "...", "solution": "..." }',
    '"determination": The root cause or final diagnosis (1-2 sentences, factual, e.g. "Axis 3 encoder calibration was lost due to a firmware update.").',
    '"solution": The corrective action taken to fix it (1-2 sentences, action-oriented, e.g. "Re-ran Kuka remastering procedure and verified all axis positions.").',
    "Return ONLY the JSON object — no markdown, no code fences, no extra text.",
    context?.ticketTitle ? `Ticket title: "${context.ticketTitle}"` : "",
    context?.customerName ? `Customer: ${context.customerName}` : "",
    context?.description
      ? `Original description (for context): ${context.description.slice(0, 300)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: "user", content: rawText.slice(0, 800) }],
  });

  const raw = getText(response);
  if (!raw) throw new Error("AI returned empty response");

  const parsed = JSON.parse(raw) as { determination?: string; solution?: string };
  if (!parsed.determination || !parsed.solution)
    throw new Error("AI response missing fields");
  return { determination: parsed.determination, solution: parsed.solution };
}

interface PolishContext {
  today?: string;
  ticketTitle?: string;
  customerName?: string;
  systemId?: string;
  assigneeName?: string;
}

export async function polishText(
  rawText: string,
  mode: "description" | "next-steps",
  context?: PolishContext
): Promise<string> {
  if (!rawText?.trim()) throw new Error("No text provided");

  const todayStr =
    context?.today ||
    new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  const systemPrompts: Record<"description" | "next-steps", string> = {
    description: [
      "You are a professional field-service ticket writer for Formic Technologies, a robotics automation company.",
      `Today's date is ${todayStr}.`,
      "Rewrite the user's plain-English input into a clear, concise ticket description.",
      "Use complete sentences. Include the problem, any known root cause, current status, and relevant technical details.",
      "Keep it factual and professional — no filler phrases like 'I hope this finds you well'.",
      "If the user mentions a date or time reference like 'yesterday' or 'this morning', resolve it relative to today's date.",
      "If the user mentions a person's name, keep it as-is (e.g. 'Nick Keyes', 'Charlson Price').",
      "If the user mentions a Slack channel, keep it as-is (e.g. '#dply_fresca').",
      "Return only the description text — no preamble, no labels.",
      context?.ticketTitle ? `Ticket title for context: "${context.ticketTitle}"` : "",
      context?.customerName ? `Customer: ${context.customerName}` : "",
      context?.systemId ? `System ID: ${context.systemId}` : "",
    ]
      .filter(Boolean)
      .join("\n"),

    "next-steps": [
      "You are a professional field-service ticket writer for Formic Technologies, a robotics automation company.",
      `Today's date is ${todayStr}.`,
      "Rewrite the user's plain-English input into a clear, concise 'Next Steps' update for a service ticket.",
      "Write in action-oriented language: what will be done, by whom, and by when (if mentioned).",
      "Keep it to 1-3 sentences. Professional but not overly formal.",
      "If the user mentions a date or time reference like 'tomorrow' or 'next week', resolve it relative to today's date.",
      "If the user mentions a person's name, keep it as-is.",
      "Return only the next-steps text — no preamble, no labels.",
      context?.ticketTitle ? `Ticket title for context: "${context.ticketTitle}"` : "",
      context?.customerName ? `Customer: ${context.customerName}` : "",
      context?.assigneeName ? `Assignee: ${context.assigneeName}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompts[mode],
    messages: [{ role: "user", content: rawText.slice(0, 1000) }],
  });

  const result = getText(response);
  if (!result) throw new Error("AI returned empty response");
  return result;
}
