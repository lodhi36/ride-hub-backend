// backend 3/config/aiConfig.js
// Configuration for AI Agent (LLM Provider & Model Selection)
// Reads LLM_API_KEY / GEMINI_API_KEY dynamically from environment variables

module.exports = {
  get provider() { return process.env.LLM_PROVIDER || 'gemini'; },
  get geminiModel() { return process.env.LLM_MODEL || 'gemini-1.5-flash'; },
  get openrouterModel() { return process.env.LLM_MODEL || 'google/gemini-2.0-flash-exp:free'; },
  get apiKey() { return process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || ''; },
  get dailyMessageLimit() { return parseInt(process.env.AI_DAILY_MESSAGE_LIMIT || '50', 10); },
};
