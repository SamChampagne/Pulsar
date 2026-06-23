export enum EmailDriver {
  SMTP = 'SMTP',
}

export enum EmailStatus {
  QUEUED = 'QUEUED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}
