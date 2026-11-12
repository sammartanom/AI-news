// Rule-based relevance filter. It is deliberately simple and explainable: an item is "relevant"
// when its title or feed excerpt mentions AI. It does not judge quality.
const AI_TERMS = /\b(ai|a\.i\.|artificial intelligence|generative|genai|chatgpt|gpt-?\d*|llms?|large language models?|machine learning|chatbots?|copilot|gemini|claude|deep ?fakes?|algorithmic|automated (grading|decision))\b/i;

export function relevance(item) {
  const hay = `${item.title} ${item.excerpt ?? ''}`;
  const matched = [...new Set((hay.match(new RegExp(AI_TERMS.source, 'gi')) ?? []).map((m) => m.toLowerCase()))];
  return { relevant: matched.length > 0, matched };
}

// Stricter than relevance(): the title itself must mention AI. Used by automatic publishing.
export const titleMentionsAI = (title) => new RegExp(AI_TERMS.source, 'i').test(String(title ?? ''));
