export type RuntimeAuthMode = 'apiKey' | 'login';

export interface RuntimeProvider {
  id: string;
  label: string;
  authMode: RuntimeAuthMode;
  providerKey: string; // Hermes model.provider value
  keyEnvVar?: string; // apiKey providers
  loginCommand?: string; // login providers — the `hermes <cmd>` subcommand
  needsBaseUrl?: boolean;
}

// Source: docs/agents-runtime-notes.md §2
// providerKey = exact model.provider value from cli-config.yaml.example:13-33
// loginCommand = the `hermes <cmd>` argument (e.g. "login" → `hermes login`)
export const RUNTIME_PROVIDERS: RuntimeProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    authMode: 'apiKey',
    providerKey: 'openrouter',
    keyEnvVar: 'OPENROUTER_API_KEY',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    authMode: 'apiKey',
    providerKey: 'anthropic',
    keyEnvVar: 'ANTHROPIC_API_KEY',
  },
  {
    // OpenAI uses the OpenAI-compatible "custom" provider in Hermes
    // (cli-config.yaml.example:36-37: OPENAI_API_KEY + OPENAI_BASE_URL)
    id: 'openai',
    label: 'OpenAI',
    authMode: 'apiKey',
    providerKey: 'custom',
    keyEnvVar: 'OPENAI_API_KEY',
    needsBaseUrl: true,
  },
  {
    // Copilot: GITHUB_TOKEN env var (gh auth fallback exists but not relied upon)
    // cli-config.yaml.example:20; hermes_cli/main.py:737-742
    id: 'copilot',
    label: 'GitHub Copilot',
    authMode: 'apiKey',
    providerKey: 'copilot',
    keyEnvVar: 'GITHUB_TOKEN',
  },
  {
    // Nous OAuth device-code flow: `hermes login`
    // cli-config.yaml.example:16; hermes_cli/subcommands/login.py:17-18
    id: 'nous',
    label: 'Nous Portal (OAuth)',
    authMode: 'login',
    providerKey: 'nous',
    loginCommand: 'login',
  },
  {
    // Nous API-key variant (separate provider key in Hermes)
    // cli-config.yaml.example:17
    id: 'nous-api',
    label: 'Nous Portal (API key)',
    authMode: 'apiKey',
    providerKey: 'nous-api',
    keyEnvVar: 'NOUS_API_KEY',
  },
  {
    // OpenAI Codex: device-code OAuth via `hermes auth add openai-codex`
    // cli-config.yaml.example:19; hermes_cli/subcommands/auth.py:14-23
    id: 'openai-codex',
    label: 'OpenAI Codex',
    authMode: 'login',
    providerKey: 'openai-codex',
    loginCommand: 'auth add openai-codex',
  },
  {
    // Generic custom / local (ollama, vllm, llamacpp, LM Studio, etc.)
    // cli-config.yaml.example:33-39
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    authMode: 'apiKey',
    providerKey: 'custom',
    keyEnvVar: 'OPENAI_API_KEY',
    needsBaseUrl: true,
  },
];

export function getRuntimeProvider(id: string): RuntimeProvider | undefined {
  return RUNTIME_PROVIDERS.find((p) => p.id === id);
}
