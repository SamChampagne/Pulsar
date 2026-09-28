import { Injectable } from '@nestjs/common';
import { SmsStatus } from '@pulsar/shared';

export interface SmsTransportResult {
  status: SmsStatus.ACCEPTED | SmsStatus.REJECTED | SmsStatus.UNKNOWN;
  providerMessageId?: string;
  errorCode?: string;
}

@Injectable()
export class TelnyxTransport {
  /** No retry: a timeout or server error may occur after the provider accepted the SMS. */
  async send(
    apiKey: string,
    message: {
      fromNumber: string;
      toNumber: string;
      text: string;
      messagingProfileId: string;
      webhookUrl?: string | null;
    },
  ): Promise<SmsTransportResult> {
    try {
      const response = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: message.fromNumber,
          to: message.toNumber,
          text: message.text,
          messaging_profile_id: message.messagingProfileId,
          type: 'SMS',
          ...(message.webhookUrl
            ? { webhook_url: message.webhookUrl, use_profile_webhooks: false }
            : {}),
        }),
      });
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        await response.body?.cancel();
        return { status: SmsStatus.REJECTED, errorCode: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { status: SmsStatus.UNKNOWN, errorCode: 'PROVIDER_UNCERTAIN' };
      }
      // Bound provider responses; never return raw provider errors or credentials.
      const reader = response.body?.getReader();
      if (!reader) return { status: SmsStatus.UNKNOWN, errorCode: 'INVALID_RESPONSE' };
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65_536) {
          await reader.cancel();
          return { status: SmsStatus.UNKNOWN, errorCode: 'INVALID_RESPONSE' };
        }
        chunks.push(value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        data?: { id?: unknown };
      };
      const id = body.data?.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id))
        return { status: SmsStatus.UNKNOWN, errorCode: 'INVALID_RESPONSE' };
      return { status: SmsStatus.ACCEPTED, providerMessageId: id };
    } catch {
      return { status: SmsStatus.UNKNOWN, errorCode: 'CONNECTION_UNCERTAIN' };
    }
  }
}
