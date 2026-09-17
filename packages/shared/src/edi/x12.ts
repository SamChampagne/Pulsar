// Pure, browser-safe. No Node imports.
//
// ANSI ASC X12 envelope tokenizer / serializer.
//
// The reader is deliberately forgiving: it NEVER throws on malformed input. It returns a
// best-effort document plus a list of structured errors so the caller (the API) can answer a
// partner with a precise reason instead of a stack trace.
//
//   const { ok, errors, document } = parseX12(text);
//
// `document` is `null` only when the ISA header itself is unusable (no ISA at all, truncated
// header, or separators that cannot be detected). Every other problem — missing IEA, SE segment
// count mismatch, control-number mismatch — yields `ok: false` with a populated `errors` array
// while `document` still holds everything that could be read.

/** Separators detected on the ISA header (or chosen when building a fresh interchange). */
export interface X12Separators {
  /** Element separator — the character at ISA position 4 (index 3), conventionally `*`. */
  element: string;
  /** Component (sub-element) separator — ISA16, conventionally `>` (or `:`). */
  subElement: string;
  /** Segment terminator — the character right after ISA16, conventionally `~`. */
  segment: string;
  /** Repetition separator — ISA11 when the version (ISA12) is >= 00402 and the value is not `U`. */
  repetition?: string;
  /** Whitespace observed after each segment terminator: `''`, `'\n'` or `'\r\n'`. */
  eol: string;
}

export const DEFAULT_X12_SEPARATORS: X12Separators = {
  element: '*',
  subElement: '>',
  segment: '~',
  eol: '',
};

/** One X12 segment. `elements[0]` is element 01 (the tag is not part of `elements`). */
export interface X12Segment {
  tag: string;
  elements: string[];
}

export interface X12Transaction {
  /** ST segment. */
  st: X12Segment;
  /** SE segment when present. */
  se?: X12Segment;
  /** Everything strictly between ST and SE, in wire order. */
  segments: X12Segment[];
  /** ST01 — `'204'`, `'210'`, `'214'`, `'990'`… */
  transactionSetId: string;
  /** ST02 — transaction control number. */
  controlNumber: string;
  /** GS01 of the enclosing functional group (`'SM'`, `'IM'`, `'QM'`, `'GF'`…). */
  functionalId: string;
}

export interface X12FunctionalGroup {
  gs: X12Segment;
  ge?: X12Segment;
  transactions: X12Transaction[];
}

export interface X12Document {
  separators: X12Separators;
  isa: X12Segment;
  iea?: X12Segment;
  groups: X12FunctionalGroup[];
  /** Flat view of every transaction of every group, in wire order. */
  transactions: X12Transaction[];
}

export type X12ErrorCode =
  | 'EMPTY_INPUT'
  | 'MISSING_ISA'
  | 'ISA_TOO_SHORT'
  | 'ISA_MALFORMED'
  | 'UNTERMINATED_SEGMENT'
  | 'MISSING_GS'
  | 'MISSING_GE'
  | 'MISSING_ST'
  | 'MISSING_SE'
  | 'MISSING_IEA'
  | 'SE_COUNT_MISMATCH'
  | 'GE_COUNT_MISMATCH'
  | 'IEA_COUNT_MISMATCH'
  | 'ST_CONTROL_MISMATCH'
  | 'GS_CONTROL_MISMATCH'
  | 'ISA_CONTROL_MISMATCH'
  | 'ORPHAN_SEGMENT'
  | 'NO_TRANSACTION';

export interface X12ParseError {
  code: X12ErrorCode;
  message: string;
  /** Segment tag the error is attached to, when relevant. */
  segment?: string;
  /** Index of the segment in the flat segment list, when relevant. */
  index?: number;
}

export interface X12ParseResult {
  /** `true` when `errors` is empty. */
  ok: boolean;
  errors: X12ParseError[];
  /** Best-effort document; `null` only when the ISA header itself could not be read. */
  document: X12Document | null;
}

/** Fixed element widths of the ISA header, in order (ISA01 … ISA16). */
export const ISA_ELEMENT_WIDTHS = [2, 10, 2, 10, 2, 15, 2, 15, 6, 4, 1, 5, 9, 1, 1, 1] as const;

/** Character count of a complete ISA header, terminator excluded. */
export const ISA_LENGTH = 105;

/** 0-based index of ISA13 (interchange control number) in `elements`. */
const ISA_CONTROL_INDEX = 12;

/** 0-based offsets inside the ISA header where the element separator must sit. */
const ISA_SEPARATOR_OFFSETS = [3, 6, 17, 20, 31, 34, 50, 53, 69, 76, 81, 83, 89, 99, 101, 103];

const ISA11_OFFSET = 82;
const ISA12_OFFSET = 84;
const ISA16_OFFSET = 104;

/** Functional identifier codes (GS01) per transaction set handled by Pulsar. */
export const X12_FUNCTIONAL_IDS = {
  '204': 'SM',
  '210': 'IM',
  '214': 'QM',
  '990': 'GF',
} as const;

function error(
  code: X12ErrorCode,
  message: string,
  extra?: { segment?: string; index?: number },
): X12ParseError {
  return { code, message, ...extra };
}

/**
 * Element accessor, 1-based like the X12 documentation (`x12Element(seg, 4)` is element 04).
 * Returns `undefined` for missing or blank elements so callers can chain `??`.
 */
export function x12Element(segment: X12Segment | undefined, position: number): string | undefined {
  if (!segment) return undefined;
  const raw = segment.elements[position - 1];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value === '' ? undefined : value;
}

/** Split a composite element on the sub-element separator. */
export function x12Components(
  value: string | undefined,
  separators: X12Separators = DEFAULT_X12_SEPARATORS,
): string[] {
  if (!value) return [];
  return value.split(separators.subElement).map((part) => part.trim());
}

/** Split a repeating element on the repetition separator (no-op when none is in force). */
export function x12Repetitions(
  value: string | undefined,
  separators: X12Separators = DEFAULT_X12_SEPARATORS,
): string[] {
  if (!value) return [];
  if (!separators.repetition) return [value];
  return value.split(separators.repetition).map((part) => part.trim());
}

/** Build a segment, dropping trailing empty elements (never the ones in between). */
export function x12Segment(
  tag: string,
  ...elements: Array<string | number | undefined>
): X12Segment {
  const values = elements.map((value) => (value === undefined ? '' : String(value)));
  while (values.length > 0 && values[values.length - 1] === '') values.pop();
  return { tag, elements: values };
}

/** Every segment of a transaction carrying this tag, in wire order. */
export function x12SegmentsOf(transaction: X12Transaction, tag: string): X12Segment[] {
  return transaction.segments.filter((segment) => segment.tag === tag);
}

/** First segment of a transaction carrying this tag. */
export function x12FirstSegment(transaction: X12Transaction, tag: string): X12Segment | undefined {
  return transaction.segments.find((segment) => segment.tag === tag);
}

/** Every transaction of a document for a given set id (`'204'`, `'210'`…). */
export function x12TransactionsOfType(document: X12Document, setId: string): X12Transaction[] {
  return document.transactions.filter((tx) => tx.transactionSetId === setId);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function detectSeparators(header: string): X12Separators | null {
  const element = header[3];
  const subElement = header[ISA16_OFFSET];
  const segment = header[ISA_LENGTH];
  if (!element || !subElement || !segment) return null;
  if (/[A-Za-z0-9 ]/.test(element) || /[A-Za-z0-9 ]/.test(segment)) return null;
  for (const offset of ISA_SEPARATOR_OFFSETS) {
    if (header[offset] !== element) return null;
  }
  const version = header.slice(ISA12_OFFSET, ISA12_OFFSET + 5);
  const repetitionChar = header[ISA11_OFFSET];
  const repetition =
    version >= '00402' && repetitionChar && repetitionChar !== 'U' && repetitionChar.trim() !== ''
      ? repetitionChar
      : undefined;
  return { element, subElement, segment, repetition, eol: '' };
}

function splitSegments(
  body: string,
  separators: X12Separators,
): { segments: X12Segment[]; unterminated: boolean } {
  const parts = body.split(separators.segment);
  const segments: X12Segment[] = [];
  let unterminated = false;
  parts.forEach((part, index) => {
    const cleaned = part.replace(/^[\r\n\t ]+/, '');
    if (cleaned.trim() === '') return;
    if (index === parts.length - 1) unterminated = true;
    const fields = cleaned.split(separators.element);
    segments.push({ tag: fields[0].trim(), elements: fields.slice(1) });
  });
  return { segments, unterminated };
}

/**
 * Tokenize an X12 interchange. Never throws.
 *
 * Separators come from the ISA header itself (fixed width, 105 characters + terminator), so a
 * partner using `:`/`+`/`'` is handled without configuration. Line breaks after a segment
 * terminator are tolerated and remembered (`separators.eol`) so `serializeX12` can reproduce the
 * exact same bytes.
 */
export function parseX12(input: string): X12ParseResult {
  const errors: X12ParseError[] = [];
  const text = typeof input === 'string' ? input : '';
  if (text.trim() === '') {
    return { ok: false, errors: [error('EMPTY_INPUT', 'Interchange is empty.')], document: null };
  }
  const start = text.indexOf('ISA');
  if (start < 0) {
    return {
      ok: false,
      errors: [error('MISSING_ISA', 'No ISA segment found — not an X12 interchange.')],
      document: null,
    };
  }
  const body = text.slice(start);
  if (body.length < ISA_LENGTH + 1) {
    return {
      ok: false,
      errors: [
        error(
          'ISA_TOO_SHORT',
          `ISA header must be ${ISA_LENGTH + 1} characters (terminator included), got ${body.length}.`,
          { segment: 'ISA' },
        ),
      ],
      document: null,
    };
  }
  const separators = detectSeparators(body);
  if (!separators) {
    return {
      ok: false,
      errors: [
        error('ISA_MALFORMED', 'ISA header does not follow the fixed-width layout.', {
          segment: 'ISA',
        }),
      ],
      document: null,
    };
  }
  separators.eol = /^[\r\n]*/.exec(body.slice(ISA_LENGTH + 1))?.[0] ?? '';

  const { segments, unterminated } = splitSegments(body, separators);
  if (unterminated) {
    errors.push(
      error('UNTERMINATED_SEGMENT', 'Last segment is not terminated.', {
        segment: segments[segments.length - 1]?.tag,
        index: segments.length - 1,
      }),
    );
  }
  const isa = segments[0];
  if (!isa || isa.tag !== 'ISA') {
    return {
      ok: false,
      errors: [...errors, error('MISSING_ISA', 'First segment is not an ISA.')],
      document: null,
    };
  }

  const document: X12Document = { separators, isa, groups: [], transactions: [] };
  let group: X12FunctionalGroup | null = null;
  let transaction: X12Transaction | null = null;
  let transactionCount = 0;

  const closeTransaction = (se: X12Segment | undefined, index: number) => {
    if (!transaction) return;
    if (se) {
      transaction.se = se;
      const declared = Number(x12Element(se, 1));
      const actual = transaction.segments.length + 2; // ST + body + SE
      if (!Number.isFinite(declared) || declared !== actual) {
        errors.push(
          error(
            'SE_COUNT_MISMATCH',
            `SE01 declares ${x12Element(se, 1) ?? '(empty)'} segments, ${actual} found.`,
            { segment: 'SE', index },
          ),
        );
      }
      const seControl = x12Element(se, 2);
      if (seControl !== transaction.controlNumber) {
        errors.push(
          error(
            'ST_CONTROL_MISMATCH',
            `SE02 (${seControl ?? '(empty)'}) does not match ST02 (${transaction.controlNumber}).`,
            { segment: 'SE', index },
          ),
        );
      }
    }
    transaction = null;
  };

  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    switch (segment.tag) {
      case 'GS': {
        if (group)
          errors.push(
            error('MISSING_GE', 'GS opened while a group was still open.', {
              segment: 'GS',
              index,
            }),
          );
        group = { gs: segment, transactions: [] };
        document.groups.push(group);
        transactionCount = 0;
        break;
      }
      case 'GE': {
        closeTransaction(undefined, index);
        if (!group) {
          errors.push(error('MISSING_GS', 'GE without a matching GS.', { segment: 'GE', index }));
          break;
        }
        group.ge = segment;
        const declared = Number(x12Element(segment, 1));
        if (!Number.isFinite(declared) || declared !== transactionCount) {
          errors.push(
            error(
              'GE_COUNT_MISMATCH',
              `GE01 declares ${x12Element(segment, 1) ?? '(empty)'} transactions, ${transactionCount} found.`,
              { segment: 'GE', index },
            ),
          );
        }
        const gsControl = x12Element(group.gs, 6);
        const geControl = x12Element(segment, 2);
        if (gsControl !== geControl) {
          errors.push(
            error(
              'GS_CONTROL_MISMATCH',
              `GE02 (${geControl ?? '(empty)'}) does not match GS06 (${gsControl ?? '(empty)'}).`,
              { segment: 'GE', index },
            ),
          );
        }
        group = null;
        break;
      }
      case 'ST': {
        if (transaction) {
          errors.push(
            error('MISSING_SE', 'ST opened while a transaction was still open.', {
              segment: 'ST',
              index,
            }),
          );
          closeTransaction(undefined, index);
        }
        if (!group) {
          errors.push(
            error('MISSING_GS', 'ST outside of any functional group.', { segment: 'ST', index }),
          );
          group = { gs: { tag: 'GS', elements: [] }, transactions: [] };
          document.groups.push(group);
          transactionCount = 0;
        }
        transaction = {
          st: segment,
          segments: [],
          transactionSetId: x12Element(segment, 1) ?? '',
          controlNumber: x12Element(segment, 2) ?? '',
          functionalId: x12Element(group.gs, 1) ?? '',
        };
        group.transactions.push(transaction);
        document.transactions.push(transaction);
        transactionCount += 1;
        break;
      }
      case 'SE': {
        if (!transaction) {
          errors.push(error('MISSING_ST', 'SE without a matching ST.', { segment: 'SE', index }));
          break;
        }
        closeTransaction(segment, index);
        break;
      }
      case 'IEA': {
        closeTransaction(undefined, index);
        if (group) {
          errors.push(
            error('MISSING_GE', 'IEA reached while a functional group was still open.', {
              segment: 'IEA',
              index,
            }),
          );
          group = null;
        }
        document.iea = segment;
        const declared = Number(x12Element(segment, 1));
        if (!Number.isFinite(declared) || declared !== document.groups.length) {
          errors.push(
            error(
              'IEA_COUNT_MISMATCH',
              `IEA01 declares ${x12Element(segment, 1) ?? '(empty)'} groups, ${document.groups.length} found.`,
              { segment: 'IEA', index },
            ),
          );
        }
        const isaControl = x12Element(isa, 13);
        const ieaControl = x12Element(segment, 2);
        if (isaControl !== ieaControl) {
          errors.push(
            error(
              'ISA_CONTROL_MISMATCH',
              `IEA02 (${ieaControl ?? '(empty)'}) does not match ISA13 (${isaControl ?? '(empty)'}).`,
              { segment: 'IEA', index },
            ),
          );
        }
        break;
      }
      default: {
        if (!transaction) {
          errors.push(
            error('ORPHAN_SEGMENT', `Segment ${segment.tag} outside of any transaction set.`, {
              segment: segment.tag,
              index,
            }),
          );
          break;
        }
        transaction.segments.push(segment);
      }
    }
  }

  if (transaction)
    errors.push(error('MISSING_SE', 'Interchange ends with an unterminated transaction set.'));
  if (group)
    errors.push(error('MISSING_GE', 'Interchange ends with an unterminated functional group.'));
  if (!document.iea) errors.push(error('MISSING_IEA', 'Interchange is missing its IEA trailer.'));
  if (document.transactions.length === 0) {
    errors.push(error('NO_TRANSACTION', 'Interchange carries no transaction set.'));
  }

  return { ok: errors.length === 0, errors, document };
}

// ---------------------------------------------------------------------------
// Serializing
// ---------------------------------------------------------------------------

function padIsaElement(value: string, width: number, index: number): string {
  const trimmed = value.length > width ? value.slice(0, width) : value;
  return index === ISA_CONTROL_INDEX ? trimmed.padStart(width, '0') : trimmed.padEnd(width, ' ');
}

/** Render an ISA header with the fixed widths the standard mandates. */
export function renderIsaSegment(elements: string[], separators: X12Separators): string {
  const padded = ISA_ELEMENT_WIDTHS.map((width, index) =>
    padIsaElement(elements[index] ?? '', width, index),
  );
  padded[ISA_ELEMENT_WIDTHS.length - 1] = separators.subElement;
  return ['ISA', ...padded].join(separators.element);
}

function renderSegment(segment: X12Segment, separators: X12Separators): string {
  if (segment.tag === 'ISA') return renderIsaSegment(segment.elements, separators);
  return [segment.tag, ...segment.elements].join(separators.element);
}

/**
 * Render a document back to wire format.
 *
 * Round-trips a parsed interchange byte for byte (same separators, same line breaks) as long as
 * the envelope counters were consistent to begin with: SE01, GE01 and IEA01 are always recomputed
 * from the actual content, and control numbers are propagated from the headers (SE02 ← ST02,
 * GE02 ← GS06, IEA02 ← ISA13).
 */
export function serializeX12(document: X12Document, overrides?: Partial<X12Separators>): string {
  const separators: X12Separators = { ...document.separators, ...overrides };
  const out: string[] = [];
  const push = (segment: X12Segment) => {
    out.push(renderSegment(segment, separators) + separators.segment + separators.eol);
  };

  push(document.isa);
  for (const group of document.groups) {
    push(group.gs);
    for (const transaction of group.transactions) {
      push(transaction.st);
      for (const segment of transaction.segments) push(segment);
      const count = transaction.segments.length + 2;
      push(x12Segment('SE', String(count), transaction.controlNumber));
    }
    push(x12Segment('GE', String(group.transactions.length), x12Element(group.gs, 6) ?? ''));
  }
  const interchangeControl = padIsaElement(
    document.isa.elements[ISA_CONTROL_INDEX] ?? '',
    ISA_ELEMENT_WIDTHS[ISA_CONTROL_INDEX],
    ISA_CONTROL_INDEX,
  );
  push(x12Segment('IEA', String(document.groups.length), interchangeControl));
  return out.join('');
}

// ---------------------------------------------------------------------------
// Envelope readers
// ---------------------------------------------------------------------------

export interface X12InterchangeHeader {
  authorizationQualifier?: string;
  authorization?: string;
  securityQualifier?: string;
  security?: string;
  senderQualifier?: string;
  senderId?: string;
  receiverQualifier?: string;
  receiverId?: string;
  /** ISA09, `YYMMDD`. */
  date?: string;
  /** ISA10, `HHMM`. */
  time?: string;
  version?: string;
  controlNumber?: string;
  ackRequested?: string;
  usageIndicator?: string;
}

/** Read the ISA header into named fields (values trimmed of their fixed-width padding). */
export function readInterchangeHeader(isa: X12Segment): X12InterchangeHeader {
  return {
    authorizationQualifier: x12Element(isa, 1),
    authorization: x12Element(isa, 2),
    securityQualifier: x12Element(isa, 3),
    security: x12Element(isa, 4),
    senderQualifier: x12Element(isa, 5),
    senderId: x12Element(isa, 6),
    receiverQualifier: x12Element(isa, 7),
    receiverId: x12Element(isa, 8),
    date: x12Element(isa, 9),
    time: x12Element(isa, 10),
    version: x12Element(isa, 12),
    controlNumber: x12Element(isa, 13),
    ackRequested: x12Element(isa, 14),
    usageIndicator: x12Element(isa, 15),
  };
}

export interface X12GroupHeader {
  functionalId?: string;
  applicationSender?: string;
  applicationReceiver?: string;
  /** GS04, `CCYYMMDD`. */
  date?: string;
  /** GS05, `HHMM`. */
  time?: string;
  controlNumber?: string;
  agencyCode?: string;
  version?: string;
}

/** Read a GS header into named fields. */
export function readGroupHeader(gs: X12Segment): X12GroupHeader {
  return {
    functionalId: x12Element(gs, 1),
    applicationSender: x12Element(gs, 2),
    applicationReceiver: x12Element(gs, 3),
    date: x12Element(gs, 4),
    time: x12Element(gs, 5),
    controlNumber: x12Element(gs, 6),
    agencyCode: x12Element(gs, 7),
    version: x12Element(gs, 8),
  };
}

// ---------------------------------------------------------------------------
// Value helpers (dates, money)
// ---------------------------------------------------------------------------

export interface X12Stamp {
  /** `CCYYMMDD`. */
  date: string;
  /** `YYMMDD`. */
  shortDate: string;
  /** `HHMM`. */
  time: string;
}

const EMPTY_STAMP: X12Stamp = { date: '', shortDate: '', time: '' };

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Turn a Date or an ISO-ish string into the X12 date/time pieces. Strings of the shape
 * `YYYY-MM-DD[THH:mm]` are read literally (no timezone shift); anything else goes through `Date`
 * and is read in UTC. Unparseable input yields empty strings — builders then omit the element
 * rather than emitting garbage (no throw anywhere in this module).
 */
export function x12Stamp(value: string | Date | undefined): X12Stamp {
  if (value === undefined || value === null) return EMPTY_STAMP;
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value.trim());
    if (match) {
      const [, year, month, day, hour, minute] = match;
      return {
        date: `${year}${month}${day}`,
        shortDate: `${year.slice(2)}${month}${day}`,
        time: hour && minute ? `${hour}${minute}` : '',
      };
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_STAMP;
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  return {
    date: `${year}${month}${day}`,
    shortDate: `${year.slice(2)}${month}${day}`,
    time: `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}`,
  };
}

/** `CCYYMMDD` (or `YYMMDD`) → `YYYY-MM-DD`. Returns `undefined` when the shape is unknown. */
export function x12DateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{6}$/.test(raw)) {
    const year = Number(raw.slice(0, 2));
    const century = year >= 70 ? '19' : '20';
    return `${century}${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
  }
  return undefined;
}

/** `HHMM` (or `HHMMSS`) → `HH:MM`. */
export function x12TimeToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!/^\d{4,6}$/.test(raw)) return undefined;
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
}

/** Combine an X12 date + time into `YYYY-MM-DDTHH:MM` (local to the partner — no timezone). */
export function x12DateTimeToIso(
  date: string | undefined,
  time: string | undefined,
): string | undefined {
  const isoDate = x12DateToIso(date);
  if (!isoDate) return undefined;
  const isoTime = x12TimeToIso(time);
  return isoTime ? `${isoDate}T${isoTime}` : isoDate;
}

/**
 * Implied-decimal (N2) money → number. `'268550'` → `2685.5`.
 *
 * X12 numeric elements typed `N2` carry two implied decimals (B3-07, L1-04, L3-05). A value that
 * already contains an explicit `.` is read as-is — some partners send `2685.50` even where the
 * standard says N2.
 */
export function fromImpliedDecimal(value: string | undefined, decimals = 2): number | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim();
  if (raw === '') return undefined;
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  if (digits.includes('.')) {
    const explicit = Number(raw);
    return Number.isFinite(explicit) ? round2(explicit) : undefined;
  }
  if (!/^\d+$/.test(digits)) return undefined;
  const parsed = Number(digits) / 10 ** decimals;
  return round2(negative ? -parsed : parsed);
}

/** Number → implied-decimal (N2) string. `2685.5` → `'268550'`. */
export function toImpliedDecimal(value: number | undefined, decimals = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const scaled = Math.round(value * 10 ** decimals);
  return scaled < 0 ? `-${Math.abs(scaled)}` : String(scaled);
}

/** Plain numeric element → number (`undefined` when blank or not numeric). */
export function x12Number(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim();
  if (raw === '' || !/^-?\d+(\.\d+)?$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Shared canonical bits used by the transaction mappers
// ---------------------------------------------------------------------------

/** A reference number and its qualifier (L11, N9). */
export interface X12Reference {
  /** Qualifier code — `'PO'`, `'BM'`, `'CN'`… */
  qualifier: string;
  value: string;
  description?: string;
}

/** A party (N1/N2/N3/N4 loop). */
export interface X12Party {
  /** N1-01 entity identifier code — `'SH'` shipper, `'CN'` consignee, `'BT'` bill-to. */
  entityCode?: string;
  name?: string;
  idQualifier?: string;
  idCode?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** A contact (G61). */
export interface X12Contact {
  /** G61-01 contact function code — `'IC'` information contact, `'CN'` general contact. */
  functionCode?: string;
  name?: string;
  communicationQualifier?: string;
  communicationNumber?: string;
}

export function readReference(segment: X12Segment): X12Reference | undefined {
  // L11 is value-then-qualifier; N9 is qualifier-then-value.
  if (segment.tag === 'N9') {
    const qualifier = x12Element(segment, 1);
    const value = x12Element(segment, 2);
    if (!qualifier && !value) return undefined;
    return { qualifier: qualifier ?? '', value: value ?? '', description: x12Element(segment, 3) };
  }
  const value = x12Element(segment, 1);
  const qualifier = x12Element(segment, 2);
  if (!value && !qualifier) return undefined;
  return { qualifier: qualifier ?? '', value: value ?? '', description: x12Element(segment, 3) };
}

export function readContact(segment: X12Segment): X12Contact {
  return {
    functionCode: x12Element(segment, 1),
    name: x12Element(segment, 2),
    communicationQualifier: x12Element(segment, 3),
    communicationNumber: x12Element(segment, 4),
  };
}

/** Apply an N1/N2/N3/N4 segment onto a party being built. */
export function applyPartySegment(party: X12Party, segment: X12Segment): X12Party {
  switch (segment.tag) {
    case 'N1':
      party.entityCode = x12Element(segment, 1);
      party.name = x12Element(segment, 2);
      party.idQualifier = x12Element(segment, 3);
      party.idCode = x12Element(segment, 4);
      break;
    case 'N2':
      party.name = party.name
        ? `${party.name} ${x12Element(segment, 1) ?? ''}`.trim()
        : x12Element(segment, 1);
      break;
    case 'N3':
      party.address1 = x12Element(segment, 1);
      party.address2 = x12Element(segment, 2);
      break;
    case 'N4':
      party.city = x12Element(segment, 1);
      party.state = x12Element(segment, 2);
      party.postalCode = x12Element(segment, 3);
      party.country = x12Element(segment, 4);
      break;
    default:
      break;
  }
  return party;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export interface X12EnvelopeOptions {
  /** ISA05, default `'ZZ'` (mutually defined). */
  senderQualifier?: string;
  /** ISA06 — our id with this partner. */
  senderId: string;
  /** ISA07, default `'ZZ'`. */
  receiverQualifier?: string;
  /** ISA08 — the partner id. */
  receiverId: string;
  /** GS02, defaults to `senderId`. */
  applicationSender?: string;
  /** GS03, defaults to `receiverId`. */
  applicationReceiver?: string;
  /** ISA13 / IEA02. */
  interchangeControlNumber: string | number;
  /** GS06 / GE02. */
  groupControlNumber: string | number;
  /** ST02 / SE02. */
  transactionControlNumber: string | number;
  /** Stamps ISA09/ISA10 and GS04/GS05. Defaults to `'1970-01-01T00:00'` when omitted. */
  at?: string | Date;
  /** ISA01, default `'00'`. */
  authorizationQualifier?: string;
  /** ISA03, default `'00'`. */
  securityQualifier?: string;
  /** ISA12, default `'00401'`. */
  versionCode?: string;
  /** GS08, default `'004010'`. */
  functionalVersion?: string;
  /** ISA14, default `'0'`. */
  ackRequested?: string;
  /** ISA15 — `'P'` production (default) or `'T'` test. */
  usageIndicator?: 'P' | 'T';
  separators?: Partial<X12Separators>;
}

/** Build a one-group, one-transaction interchange around the given transaction segments. */
export function buildX12Interchange(
  envelope: X12EnvelopeOptions,
  functionalId: string,
  transactionSetId: string,
  segments: X12Segment[],
): string {
  const separators: X12Separators = { ...DEFAULT_X12_SEPARATORS, ...envelope.separators };
  const stamp = x12Stamp(envelope.at ?? '1970-01-01T00:00');
  const transactionControl = String(envelope.transactionControlNumber).padStart(4, '0');
  const isa: X12Segment = {
    tag: 'ISA',
    elements: [
      envelope.authorizationQualifier ?? '00',
      '',
      envelope.securityQualifier ?? '00',
      '',
      envelope.senderQualifier ?? 'ZZ',
      envelope.senderId,
      envelope.receiverQualifier ?? 'ZZ',
      envelope.receiverId,
      stamp.shortDate,
      stamp.time,
      'U',
      envelope.versionCode ?? '00401',
      String(envelope.interchangeControlNumber),
      envelope.ackRequested ?? '0',
      envelope.usageIndicator ?? 'P',
      separators.subElement,
    ],
  };
  const gs = x12Segment(
    'GS',
    functionalId,
    envelope.applicationSender ?? envelope.senderId.trim(),
    envelope.applicationReceiver ?? envelope.receiverId.trim(),
    stamp.date,
    stamp.time,
    String(envelope.groupControlNumber),
    'X',
    envelope.functionalVersion ?? '004010',
  );
  const st = x12Segment('ST', transactionSetId, transactionControl);
  const document: X12Document = {
    separators,
    isa,
    groups: [
      {
        gs,
        transactions: [
          {
            st,
            segments,
            transactionSetId,
            controlNumber: transactionControl,
            functionalId,
          },
        ],
      },
    ],
    transactions: [],
  };
  document.transactions = document.groups[0].transactions;
  return serializeX12(document);
}
