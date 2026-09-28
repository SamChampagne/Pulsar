import { TelnyxTransport } from './telnyx.transport';
import { SmsStatus } from '@pulsar/shared';
describe('Telnyx transport — mocked HTTP only', () => {
  const transport = new TelnyxTransport();
  const message = {
    fromNumber: '+15145550123',
    toNumber: '+15145550456',
    text: 'Bonjour',
    messagingProfileId: 'f412de89-9639-4c83-a63b-2f3aaa072f8e',
  };
  afterEach(() => jest.restoreAllMocks());
  it('uses the fixed v2 endpoint, bearer secret, explicit SMS and bounded timeout', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'provider-message-id' } }), { status: 200 }),
      );
    expect(await transport.send('fake-test-key', message)).toEqual({
      status: SmsStatus.ACCEPTED,
      providerMessageId: 'provider-message-id',
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer fake-test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      from: message.fromNumber,
      to: message.toNumber,
      text: message.text,
      messaging_profile_id: message.messagingProfileId,
      type: 'SMS',
    });
  });
  it.each([400, 401, 403, 422, 429])(
    'records HTTP %s as rejected without exposing response body',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('secret and private provider detail', { status }));
      expect(await transport.send('secret', message)).toEqual({
        status: SmsStatus.REJECTED,
        errorCode: `HTTP_${status}`,
      });
    },
  );
  it.each([408, 500, 503])('does not retry uncertain HTTP %s', async (status) => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    expect((await transport.send('secret', message)).status).toBe(SmsStatus.UNKNOWN);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry a lost response', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret'));
    expect(await transport.send('secret', message)).toEqual({
      status: SmsStatus.UNKNOWN,
      errorCode: 'CONNECTION_UNCERTAIN',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    '{}',
    '<html>error</html>',
    JSON.stringify({ data: { id: 'private\nheader' } }),
    'x'.repeat(70000),
  ])('handles malformed or excessive bodies conservatively', async (body) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    expect((await transport.send('secret', message)).status).toBe(SmsStatus.UNKNOWN);
  });
});
