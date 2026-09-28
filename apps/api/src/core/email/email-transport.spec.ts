import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { EmailService } from './email.service';
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
describe('Email SMTP identity — no network', () => {
  const sendMail = jest.fn(async () => ({}));
  const close = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (createTransport as jest.Mock).mockReturnValue({ sendMail, close });
  });
  const smtp = {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    from: 'Sender <from@example.test>',
    replyTo: 'replies@example.test',
  };
  const message = { to: 'to@example.test', subject: 'Subject', html: '<p>Hello</p>' };
  it('applies tenant Reply-To and sender and closes its one-off transport', async () => {
    const service = new EmailService(new ConfigService({ EMAIL_DRIVER: 'log' }));
    expect(await service.send(message, smtp)).toBe(true);
    expect(sendMail).toHaveBeenCalledWith({ ...message, from: smtp.from, replyTo: smtp.replyTo });
    expect(close).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: 10000, socketTimeout: 30000 }),
    );
  });
  it('keeps explicit message identity overrides', async () => {
    const service = new EmailService(new ConfigService({ EMAIL_DRIVER: 'log' }));
    await service.send(
      { ...message, from: 'override@example.test', replyTo: 'specific@example.test' },
      smtp,
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'override@example.test', replyTo: 'specific@example.test' }),
    );
  });
  it('closes the transport on a failed SMTP handoff too', async () => {
    const service = new EmailService(new ConfigService({ EMAIL_DRIVER: 'log' }));
    sendMail.mockRejectedValueOnce(new Error('Injected failure'));
    expect(await service.send(message, smtp)).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
