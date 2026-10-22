/**
 * The questions shown on an empty chat: things people really ask, worded so the
 * app finds them well (the last meeting, this week's todos, the real PR and
 * ticket lists). Ticket and pull request examples only appear when a plugin
 * offers those (`kinds` are the enabled plugins' `chat.kind`).
 */
export function chatExamples(kinds: string[]): string[] {
  const examples = ["What did we decide in the last meeting?", "What do I need to do this week?", "Which todo is the most important?"];
  if (kinds.some((k) => /ticket|issue/i.test(k))) examples.push("Which tickets are assigned to me?");
  if (kinds.some((k) => /pull request/i.test(k))) examples.push("Do I have any open pull requests?");
  return examples;
}
