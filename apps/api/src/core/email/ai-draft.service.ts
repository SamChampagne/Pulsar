import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

export interface AiDraftInput {
  prompt: string;
  context?: string;
}

export interface AiDraftResult {
  subject: string;
  html: string;
}

/**
 * One-shot LLM completion to draft a business email (subject + html body).
 *
 * Supported providers (determined by `AgentRuntimeConfig.provider`):
 *   - "anthropic"   → POST https://api.anthropic.com/v1/messages
 *   - "openrouter"  → POST https://openrouter.ai/api/v1/chat/completions
 *
 * The service uses a direct `fetch` call — no Hermes/ACP session is spawned.
 * Best-effort: provider errors surface as a clear BadRequestException.
 */
@Injectable()
export class AiDraftService {
  private readonly logger = new Logger(AiDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async draft(tenantId: string, input: AiDraftInput): Promise<AiDraftResult> {
    const config = await this.prisma.agentRuntimeConfig.findUnique({ where: { tenantId } });
    if (!config) {
      throw new BadRequestException('No LLM configured for this tenant');
    }

    const decryptedKey = config.apiKeyEnc ? this.crypto.decryptString(config.apiKeyEnc) : null;
    if (!decryptedKey) {
      throw new BadRequestException('No LLM configured for this tenant');
    }

    const provider = (config.provider ?? '').toLowerCase();
    const model = config.defaultModel ?? this.defaultModel(provider);

    const systemPrompt = `You are a professional business email writer. When given a prompt and optional context, produce a concise business email. Reply ONLY with a JSON object containing exactly two keys: "subject" (string, the email subject line) and "html" (string, the email body as valid HTML with paragraph tags). No markdown, no explanation, only the JSON object.`;

    const userMessage = input.context
      ? `Context:\n${input.context}\n\nEmail prompt:\n${input.prompt}`
      : `Email prompt:\n${input.prompt}`;

    try {
      if (provider === 'anthropic') {
        return await this.callAnthropic(decryptedKey, model, systemPrompt, userMessage);
      } else if (provider === 'openrouter') {
        const baseUrl = config.baseUrl ?? 'https://openrouter.ai';
        return await this.callOpenRouterStyle(decryptedKey, model, systemPrompt, userMessage, baseUrl, 'openrouter');
      } else {
        // Fallback: attempt OpenAI-compatible chat completion (covers generic providers).
        const baseUrl = config.baseUrl ?? 'https://api.openai.com';
        return await this.callOpenRouterStyle(decryptedKey, model, systemPrompt, userMessage, baseUrl, provider);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AiDraftService: provider error for tenant ${tenantId}: ${msg}`);
      throw new BadRequestException(`LLM provider error: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Anthropic messages API
  // ---------------------------------------------------------------------------
  private async callAnthropic(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
  ): Promise<AiDraftResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new BadRequestException(`Anthropic API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
    return this.parseResponse(text);
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compatible chat completion (OpenRouter, OpenAI, etc.)
  // ---------------------------------------------------------------------------
  private async callOpenRouterStyle(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userMessage: string,
    baseUrl: string,
    providerLabel: string,
  ): Promise<AiDraftResult> {
    const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new BadRequestException(`${providerLabel} API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return this.parseResponse(text);
  }

  // ---------------------------------------------------------------------------
  // Parse the model's JSON response robustly
  // ---------------------------------------------------------------------------
  private parseResponse(text: string): AiDraftResult {
    // Try to extract JSON from the response (model may wrap it in markdown fences).
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
        const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
        if (subject && html) {
          return { subject, html };
        }
      } catch {
        // Fall through to heuristic fallback.
      }
    }

    // Fallback: use the raw text as the html body with a generic subject.
    return {
      subject: 'Draft email',
      html: text.trim() ? `<p>${text.trim()}</p>` : '<p>Please revise this draft.</p>',
    };
  }

  private defaultModel(provider: string): string {
    if (provider === 'anthropic') return 'claude-3-5-haiku-20241022';
    if (provider === 'openrouter') return 'anthropic/claude-3-5-haiku';
    return 'gpt-4o-mini';
  }
}
