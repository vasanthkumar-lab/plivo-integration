import type { CallLog, EndedBy } from './crm.types';

/**
 * Turning Plivo's wire vocabulary into something a sales rep can read.
 *
 * Plivo reports a hangup three different ways -- the SIP cause on the browser
 * leg, the FreeSWITCH cause on the dial webhook, and CallStatus on the hangup
 * webhook -- and none of them are phrased for a human. A rep who puts the phone
 * down should never be told the call "failed".
 */

/** Plivo's B-leg hangup causes. Anything unlisted falls through to 'failed'. */
const CAUSE_TO_STATUS: Record<string, CallLog['status']> = {
  NORMAL_CLEARING: 'completed',
  ORIGINATOR_CANCEL: 'canceled',
  USER_BUSY: 'busy',
  CALL_REJECTED: 'declined',
  NO_ANSWER: 'no-answer',
  NO_USER_RESPONSE: 'no-answer',
  ALLOTTED_TIMEOUT: 'no-answer',
  SUBSCRIBER_ABSENT: 'no-answer',
  UNALLOCATED_NUMBER: 'failed',
  RECOVERY_ON_TIMER_EXPIRE: 'no-answer',
};

/** CallStatus as the Hangup URL reports it. */
const CALLSTATUS_TO_STATUS: Record<string, CallLog['status']> = {
  completed: 'completed',
  cancel: 'canceled',
  canceled: 'canceled',
  cancelled: 'canceled',
  busy: 'busy',
  timeout: 'no-answer',
  'no-answer': 'no-answer',
  noanswer: 'no-answer',
  failed: 'failed',
};

export function statusFromCause(cause: string): CallLog['status'] | null {
  return CAUSE_TO_STATUS[String(cause || '').trim().toUpperCase()] ?? null;
}

export function statusFromCallStatus(value: string): CallLog['status'] | null {
  return CALLSTATUS_TO_STATUS[String(value || '').trim().toLowerCase()] ?? null;
}

/**
 * Which human ended the call.
 *
 * On the dial webhook the B leg is whoever we bridged to, so 'Callee' is the
 * customer on an outbound call but the rep on an inbound one. Getting this
 * backwards is how you end up telling a rep the customer hung up on them.
 */
export function partyFromDialSource(
  source: string,
  direction: CallLog['direction'],
): EndedBy {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'callee') return direction === 'outbound' ? 'customer' : 'rep';
  if (s === 'caller') return direction === 'outbound' ? 'rep' : 'customer';
  return 'system';
}

function secs(sec: number): string {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** Short headline, e.g. for a toast or a list row. */
export function titleForOutcome(call: Pick<CallLog, 'status' | 'endedBy' | 'direction'>): string {
  switch (call.status) {
    case 'completed':
      if (call.endedBy === 'customer') return 'Customer ended the call';
      if (call.endedBy === 'rep') return 'You ended the call';
      return 'Call ended';
    case 'canceled':
      return call.direction === 'outbound' ? 'Call cancelled' : 'Caller hung up';
    case 'declined':
      return call.endedBy === 'rep' ? 'You declined the call' : 'Customer declined';
    case 'busy':
      return 'Line busy';
    case 'no-answer':
      return 'No answer';
    case 'failed':
      return 'Call could not connect';
    default:
      return 'Call ended';
  }
}

/** The sentence under the headline, and the line written to the lead timeline. */
export function describeOutcome(
  call: Pick<CallLog, 'status' | 'endedBy' | 'direction' | 'durationSec'>,
): string {
  const d = secs(call.durationSec);
  switch (call.status) {
    case 'completed':
      if (call.endedBy === 'customer') return `Customer hung up after ${d}.`;
      if (call.endedBy === 'rep') return `You hung up after ${d}.`;
      return `Connected for ${d}.`;
    case 'canceled':
      return call.direction === 'outbound'
        ? 'You hung up before the customer answered.'
        : 'The caller hung up before you answered.';
    case 'declined':
      return call.endedBy === 'rep'
        ? 'You rejected this call.'
        : 'The customer rejected the call.';
    case 'busy':
      return 'The customer was on another call.';
    case 'no-answer':
      return call.direction === 'outbound'
        ? 'The customer did not pick up.'
        : 'Nobody answered this caller.';
    case 'failed':
      return 'The call could not be connected.';
    default:
      return `Call ended after ${d}.`;
  }
}
