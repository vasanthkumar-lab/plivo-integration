'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from './api';
import { describeOutcome, titleForOutcome } from './callOutcome';
import type { Toast } from '@/components/Toasts';
import type {
  Activity,
  CallLog,
  Disposition,
  Lead,
  PhoneState,
  PlivoRuntimeConfig,
  Rep,
  AnalysisConfig,
  CallAnalysis,
  Transcript,
  TranscriptionConfig,
  WireEntry,
} from './types';

/**
 * JsSIP reports the reason a session never reached "connected". Most of these
 * are ordinary call outcomes -- only the last group is a genuine fault.
 */
function explainSdkCause(cause: string): {
  title: string;
  body: string;
  kind: Toast['kind'];
} {
  const c = cause.toLowerCase();

  if (c.includes('cancel'))
    return { title: 'Call cancelled', body: 'You hung up before the call connected.', kind: 'info' };
  if (c.includes('rejected') || c.includes('decline'))
    return { title: 'Customer declined', body: 'The call was rejected at the other end.', kind: 'warn' };
  if (c.includes('busy'))
    return { title: 'Line busy', body: 'The number is engaged. Try again shortly.', kind: 'warn' };
  if (c.includes('unavailable') || c.includes('not found') || c.includes('incomplete'))
    return { title: 'Could not reach that number', body: 'Check the number and try again.', kind: 'warn' };
  if (c.includes('timeout') || c.includes('no answer'))
    return { title: 'No answer', body: 'The customer did not pick up.', kind: 'warn' };
  if (c.includes('terminated') || c.includes('bye'))
    return { title: 'Call ended', body: 'The call was ended.', kind: 'info' };
  if (c.includes('media') || c.includes('denied'))
    return { title: 'Microphone blocked', body: 'Allow the microphone to make calls.', kind: 'error' };

  // Connection / authentication / internal faults.
  return { title: 'Call could not connect', body: cause, kind: 'error' };
}

/**
 * The whole demo's state machine.
 *
 * Simulator mode: call control goes through /api/sim/*, which posts real Plivo
 * webhook payloads into the real Answer URL / Hangup URL handlers.
 * Live mode: call control goes through the Plivo Browser SDK over WebRTC; the
 * backend handlers are driven by Plivo itself.
 */
export function useSoftphone() {
  const [config, setConfig] = useState<PlivoRuntimeConfig | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [wire, setWire] = useState<WireEntry[]>([]);
  const [repId, setRepId] = useState('u_ravi');
  const [phone, setPhone] = useState<PhoneState>({ kind: 'offline' });
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<CallLog[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  const [transcribing, setTranscribing] = useState<Record<string, boolean>>({});
  const [transcription, setTranscription] = useState<TranscriptionConfig | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, CallAnalysis>>({});
  const [analysing, setAnalysing] = useState<Record<string, boolean>>({});
  const [analysisConfig, setAnalysisConfig] = useState<AnalysisConfig | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((kind: Toast['kind'], title: string, body?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((list) => {
      // Collapse repeats: the same event can reach us twice (an SDK that
      // re-emits on keep-alive, or React re-running an effect in development).
      if (list.some((t) => t.title === title && t.body === body)) return list;
      return [...list.slice(-4), { id, kind, title, body }];
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const phoneRef = useRef<PhoneState>(phone);
  phoneRef.current = phone;
  const leadsRef = useRef<Lead[]>(leads);
  leadsRef.current = leads;
  const callsRef = useRef<CallLog[]>(calls);
  callsRef.current = calls;
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const plivoRef = useRef<any>(null);
  const registerInFlight = useRef(false);
  const reloginAttempts = useRef(0);

  const rep = reps.find((r) => r.id === repId) || null;

  // ---------------------------------------------------------------- data
  /**
   * Recordings arrive after the call, so they are fetched separately from the
   * CRM snapshot. This endpoint reconciles with Plivo's Recordings API, which
   * is why a missed callback still shows up here.
   */
  const refreshRecordings = useCallback(async () => {
    try {
      setRecordings(await api.recordings());
    } catch {
      /* leave the previous list in place */
    }
  }, []);

  /** Fetch one transcript on demand -- the list view does not need them all. */
  const loadTranscript = useCallback(async (callUuid: string) => {
    try {
      const t = await api.transcript(callUuid);
      setTranscripts((prev) => ({ ...prev, [callUuid]: t }));
      return t;
    } catch {
      return null;
    }
  }, []);

  /** Ask the server to transcribe (or re-transcribe) a recording. */
  const requestTranscript = useCallback(
    async (callUuid: string, force = false, language?: string) => {
      setTranscribing((prev) => ({ ...prev, [callUuid]: true }));
      try {
        const res = await api.requestTranscript(callUuid, force, language);
        if (res.transcript) {
          setTranscripts((prev) => ({ ...prev, [callUuid]: res.transcript as Transcript }));
        }
        if (!res.ok && res.error) pushToast('error', 'Could not transcribe', res.error);
      } catch (e: any) {
        pushToast('error', 'Could not transcribe', e?.message ?? 'Request failed');
      } finally {
        setTranscribing((prev) => ({ ...prev, [callUuid]: false }));
      }
    },
    [pushToast],
  );

  /** Fetch one call's AI verdict on demand. */
  const loadAnalysis = useCallback(async (callUuid: string) => {
    try {
      const a = await api.analysis(callUuid);
      setAnalyses((prev) => ({ ...prev, [callUuid]: a }));
      return a;
    } catch {
      return null;
    }
  }, []);

  const requestAnalysis = useCallback(
    async (callUuid: string, force = false) => {
      setAnalysing((prev) => ({ ...prev, [callUuid]: true }));
      try {
        const res = await api.requestAnalysis(callUuid, force);
        if (res.analysis) {
          setAnalyses((prev) => ({ ...prev, [callUuid]: res.analysis as CallAnalysis }));
        }
        if (!res.ok) {
          if (res.error) pushToast('error', 'Could not analyse', res.error);
          setAnalysing((prev) => ({ ...prev, [callUuid]: false }));
          return;
        }

        /**
         * The work continues on the server and normally arrives over SSE. Poll
         * as a backstop: one dropped event used to leave "Reading the
         * conversation…" on screen forever with no way back.
         */
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const latest = await api.analysis(callUuid).catch(() => null);
          if (!latest) continue;
          setAnalyses((prev) => ({ ...prev, [callUuid]: latest }));
          if (latest.status === 'ready' || latest.status === 'failed') break;
        }
        setAnalysing((prev) => ({ ...prev, [callUuid]: false }));
      } catch (e: any) {
        pushToast('error', 'Could not analyse', e?.message ?? 'Request failed');
        setAnalysing((prev) => ({ ...prev, [callUuid]: false }));
      }
    },
    [pushToast],
  );

  const refresh = useCallback(async () => {
    const data = await api.bootstrap(repId);
    setReps(data.reps);
    setLeads(data.leads);
    setCalls(data.calls);
    setActivities(data.activities);
  }, [repId]);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, data, w] = await Promise.all([api.plivoConfig(), api.bootstrap(), api.wireLog()]);
        setConfig(cfg);
        api.transcriptionConfig().then(setTranscription).catch(() => undefined);
        api.analysisConfig().then(setAnalysisConfig).catch(() => undefined);
        setReps(data.reps);
        setLeads(data.leads);
        setCalls(data.calls);
        setActivities(data.activities);
        setWire(w);

        /**
         * GET /api/recordings reconciles with Plivo and can create call rows
         * the bootstrap above did not have. The server announces that over SSE,
         * but the EventSource may not be connected yet, so the event can be
         * missed -- re-read the snapshot once the sync has finished instead of
         * leaving the pipeline and the stats showing zero.
         */
        await refreshRecordings();
        await refresh().catch(() => undefined);
      } catch {
        setError('Cannot reach the API on ' + API_BASE + '. Is the backend running?');
        pushToast('error', 'Backend unreachable', 'Cannot reach the API. Is the server running?');
      }
    })();
  }, []);

  // ------------------------------------------------------- live event feed
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events/stream`);

    /**
     * A dropped stream used to mean the call log simply stopped updating until
     * the page was reloaded -- a call would sit at 00:00 "Call ended" while the
     * server already knew its duration. Re-read the snapshot on every
     * (re)connect so a gap in the stream costs at most one refresh.
     */
    es.onopen = () => {
      refresh().catch(() => undefined);
    };

    es.onmessage = (ev) => {
      const event = JSON.parse(ev.data) as { type: string; payload: any };

      if (event.type === 'wire') {
        setWire((prev) => [...prev.slice(-199), event.payload as WireEntry]);
        return;
      }

      if (event.type === 'incoming-call') {
        // Only ring the rep this browser is logged in as.
        if (event.payload.repId !== repId) return;
        if (phoneRef.current.kind === 'in-call' || phoneRef.current.kind === 'ringing-in') return;
        pushToast('info', 'Incoming call', event.payload.from);
        setPhone({
          kind: 'ringing-in',
          lead: event.payload.lead ?? null,
          from: event.payload.from,
          callUuid: event.payload.callUuid,
        });
        return;
      }

      if (event.type === 'call-answered') {
        const cur = phoneRef.current;
        if (cur.kind === 'dialing' || cur.kind === 'ringing-in') {
          setPhone({
            kind: 'in-call',
            lead: cur.kind === 'dialing' ? cur.lead : cur.lead,
            callUuid: cur.callUuid,
            startedAt: Date.now(),
            direction: cur.kind === 'dialing' ? 'outbound' : 'inbound',
          });
          setElapsed(0);
        }
        return;
      }

      /**
       * The backend heartbeats the public tunnel. When it flips, refresh config
       * so the blocker banner matches reality, and say so out loud -- otherwise
       * a dead tunnel only shows up as a misleading "Busy" on the next call.
       */
      if (event.type === 'plivo-config') {
        api.plivoConfig().then(setConfig).catch(() => undefined);
        if (event.payload?.tunnel?.ok === false) {
          pushToast(
            'error',
            'Tunnel is down',
            'Plivo cannot reach your Answer URL — calls will fail until it is back.',
          );
        } else if (event.payload?.tunnel?.ok === true) {
          pushToast('success', 'Tunnel is up', 'Plivo can reach your Answer URL again.');
        }
        return;
      }

      if (event.type === 'transcript-ready') {
        const { callUuid, status } = event.payload ?? {};
        if (!callUuid) return;
        if (status === 'ready') {
          loadTranscript(callUuid);
          pushToast('success', 'Transcript ready', 'The conversation is now searchable.');
          refresh();
        } else if (status === 'failed') {
          pushToast('warn', 'Transcription failed', 'Open the call and retry.');
          loadTranscript(callUuid);
        }
        refreshRecordings();
        return;
      }

      if (event.type === 'analysis-ready') {
        const { callUuid, status } = event.payload ?? {};
        if (!callUuid) return;
        if (status !== 'pending') {
          setAnalysing((prev) => ({ ...prev, [callUuid]: false }));
        }
        if (status === 'ready') {
          loadAnalysis(callUuid);
          pushToast('success', 'AI analysis ready', 'The call verdict is in.');
        } else if (status === 'failed') {
          loadAnalysis(callUuid);
        }
        refresh();
        return;
      }

      if (event.type === 'crm-updated' && event.payload?.reason === 'recording') {
        pushToast('success', 'Recording ready', 'Audio attached to the call.');
        refresh();
        return;
      }

      if (event.type === 'call-ended') {
        const call = event.payload as CallLog;
        const cur = phoneRef.current;

        const title = titleForOutcome(call);
        const summary = describeOutcome(call);
        pushToast(
          call.status === 'completed' ? 'success' : call.status === 'failed' ? 'error' : 'warn',
          title,
          summary,
        );
        /**
         * In live mode the Browser SDK never hands us a usable CallUUID: a call
         * starts as `callUuid: ''` and the SDK's onCallTerminated carries that
         * empty string into wrap-up. The Hangup URL is the only place the real
         * id appears, so adopt it here -- including when wrap-up has already
         * been entered, which is the common case and used to leave the
         * disposition posting to /api/calls//disposition and 404ing.
         *
         * Adopt it over an id the CRM has never heard of, too. An inbound call
         * used to reach wrap-up holding Plivo's B leg UUID, which is truthy and
         * unequal to the A leg id below, so a plain equality test rejected the
         * correction and left the rep unable to save an outcome at all.
         */
        const matches =
          (cur.kind === 'in-call' || cur.kind === 'dialing' || cur.kind === 'wrap-up') &&
          (cur.callUuid === call.callUuid ||
            !cur.callUuid ||
            !callsRef.current.some((c) => c.callUuid === cur.callUuid));
        if (matches) {
          setPhone({
            kind: 'wrap-up',
            lead:
              (call.leadId ? leadsRef.current.find((l) => l.id === call.leadId) : null) ??
              (cur.kind === 'wrap-up' ? cur.lead : null),
            callUuid: call.callUuid,
            // The SDK's own timer is more accurate than a webhook that can
            // report 0 for a call we were plainly on.
            durationSec: call.durationSec || (cur.kind === 'wrap-up' ? cur.durationSec : 0),
            title,
            summary,
          });
        }
        refresh();
        // The hangup webhook, the recording callback and the transcript all
        // arrive separately over the next few seconds. One refresh catches
        // whichever has landed; these catch the rest.
        setTimeout(() => refresh().catch(() => undefined), 4000);
        setTimeout(() => refresh().catch(() => undefined), 12000);
        setTimeout(refreshRecordings, 4000);
        setTimeout(refreshRecordings, 12000);
        return;
      }

      if (event.type === 'crm-updated') refresh();
    };

    es.onerror = () => {
      /* EventSource retries on its own */
    };

    return () => es.close();
  }, [repId, refresh, pushToast]);

  /**
   * Belt and braces for the live feed.
   *
   * Returning to the tab re-reads immediately, and a slow poll covers the case
   * where the stream is up but an event was missed. Neither is the primary
   * path -- they exist so the UI can never sit on stale data the way it did
   * when only SSE kept it current.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh().catch(() => undefined);
    }, 20000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(poll);
    };
  }, [refresh]);

  // ------------------------------------------------------------- in-call timer
  useEffect(() => {
    if (phone.kind !== 'in-call') return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - phone.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [phone]);

  // ------------------------------------------------- register with Plivo
  const register = useCallback(async () => {
    // One registration at a time. Without this, a second call builds a second
    // Plivo client, and every SDK event then arrives twice.
    if (registerInFlight.current) return;
    if (plivoRef.current) return;
    registerInFlight.current = true;

    setError(null);
    setPhone({ kind: 'registering' });
    try {
      const { token, simulated } = await api.token(repId);

      if (simulated) {
        // No credentials: skip WebRTC registration, the simulator drives the calls.
        setTimeout(() => {
          setPhone({ kind: 'ready' });
          api.setPresence(repId, true).catch(() => undefined);
        }, 650);
        return;
      }

      // Ask for the microphone up front. Deferring it (permOnClick) means the
      // browser has no media ready when an inbound call arrives.
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        api.clientEvent('Microphone permission granted');
      } catch {
        api.clientEvent('Microphone permission DENIED', 'calls cannot carry audio');
        setError('Microphone permission is required to make or receive calls.');
        pushToast('warn', 'Microphone blocked', 'Allow the microphone to make or receive calls.');
      }

      const { default: Plivo } = await import('plivo-browser-sdk');
      const plivo = new Plivo({ debug: 'ERROR', enableTracking: true });
      plivoRef.current = plivo;

      plivo.client.on('onLogin', () => {
        reloginAttempts.current = 0;
        setPhone({ kind: 'ready' });
        pushToast('success', 'Phone ready', 'Registered with Plivo — inbound calls will ring.');
        api.clientEvent('SDK onLogin', `registered as ${rep?.endpoint ?? repId} - ready for inbound`);
        api.setPresence(repId, true).catch(() => undefined);
      });
      plivo.client.on('onLogout', () => {
        api.clientEvent('SDK onLogout', 'browser is no longer reachable for inbound');
        api.setPresence(repId, false).catch(() => undefined);
      });
      plivo.client.on('onLoginFailed', async (cause: string) => {
        const reason = String(cause);
        api.clientEvent('SDK onLoginFailed', reason);

        /**
         * Tokens last five minutes. When the SDK re-registers after a network
         * blip it may present an expired one, which is a routine event, not a
         * failure the rep should have to act on: fetch a fresh token and log in
         * again on the same client, keeping every handler attached.
         */
        const expired = /EXPIRED|TOKEN/i.test(reason);
        if (expired && reloginAttempts.current < 3) {
          reloginAttempts.current += 1;
          setPhone({ kind: 'registering' });
          try {
            const fresh = await api.token(repId);
            api.clientEvent('Token refreshed', `attempt ${reloginAttempts.current} — re-registering`);
            plivo.client.loginWithAccessToken(fresh.token);
            return;
          } catch {
            /* fall through to the visible failure below */
          }
        }

        pushToast('error', 'Phone disconnected', `${reason}. Use Register phone to retry.`);
        setPhone({ kind: 'offline' });
      });
      plivo.client.on('onIncomingCall', (from: string, headers: any, callInfo: any) => {
        api.clientEvent('SDK onIncomingCall', `from ${from}`, { callInfo, headers });
        const digits = String(from).replace(/\D/g, '').slice(-10);
        const cur = phoneRef.current;
        setPhone({
          kind: 'ringing-in',
          from,
          lead:
            (cur.kind === 'ringing-in' ? cur.lead : null) ??
            leadsRef.current.find((l) => l.phone.replace(/\D/g, '').endsWith(digits)) ??
            null,
          /**
           * Deliberately NOT callInfo.callUUID.
           *
           * On an inbound call Plivo hands the Browser SDK the *B leg* id -- the
           * SIP leg down to this endpoint -- while the CRM keys every call by the
           * A leg id that the Answer URL reports. Those are two different UUIDs
           * for the one call, so storing the B leg here is what made wrap-up POST
           * to /api/calls/<b-leg>/disposition and 404 with "Could not save the
           * outcome".
           *
           * Keep the real id if the backend's incoming-call event beat us here;
           * otherwise leave it empty so call-ended adopts the A leg id below.
           */
          callUuid: cur.kind === 'ringing-in' ? cur.callUuid : '',
        });
      });
      plivo.client.on('onIncomingCallCanceled', () => {
        api.clientEvent('SDK onIncomingCallCanceled', 'caller hung up before answer');
        if (phoneRef.current.kind === 'ringing-in') setPhone({ kind: 'ready' });
      });
      plivo.client.on('onCallAnswered', () => {
        const cur = phoneRef.current;
        if (cur.kind === 'dialing' || cur.kind === 'ringing-in') {
          setPhone({
            kind: 'in-call',
            lead: cur.lead,
            callUuid: cur.callUuid,
            startedAt: Date.now(),
            direction: cur.kind === 'dialing' ? 'outbound' : 'inbound',
          });
        }
      });
      plivo.client.on('onCallTerminated', () => {
        const cur = phoneRef.current;
        if (cur.kind === 'in-call') {
          setPhone({ kind: 'wrap-up', lead: cur.lead, callUuid: cur.callUuid, durationSec: elapsedRef.current });
        } else if (cur.kind !== 'wrap-up') {
          setPhone({ kind: 'ready' });
        }
        // The SDK ends the call before Plivo has posted the Hangup URL, so this
        // first read still shows the call in progress. Look again once the
        // webhook has had time to land.
        refresh();
        setTimeout(() => refresh().catch(() => undefined), 2500);
        setTimeout(() => refresh().catch(() => undefined), 8000);
      });
      /**
        * The SDK calls every non-connected ending a "failure", including the
        * rep hanging up before the customer answered. Translate the SIP cause
        * into what actually happened, and only treat a real fault as an error.
        */
      plivo.client.on('onCallFailed', (cause: string) => {
        const { title, body, kind } = explainSdkCause(String(cause));
        api.clientEvent('SDK onCallFailed', String(cause));
        // A persistent banner is for faults the rep must act on, not for a
        // customer who declined.
        setError(kind === 'error' ? `${title}: ${body}` : null);
        pushToast(kind, title, body);
        setPhone({ kind: 'ready' });
      });

      api.clientEvent('loginWithAccessToken()', `logging in as ${rep?.endpoint ?? repId}`);
      plivo.client.loginWithAccessToken(token);
    } catch (e: any) {
      setError(e?.message ?? 'Registration failed');
      pushToast('error', 'Could not register phone', e?.message ?? 'Registration failed');
      setPhone({ kind: 'offline' });
    } finally {
      registerInFlight.current = false;
    }
  }, [repId, refresh]);

  /**
   * Register automatically once config is known, and again when the rep changes.
   *
   * Inbound calls only work while the browser holds a SIP registration with
   * Plivo: if nobody is registered, Plivo ends the call immediately with
   * "End Of XML Instructions" and the caller just hears it drop. Making the rep
   * click a button first means a page refresh silently breaks inbound, so the
   * phone comes up on its own, exactly like a desk phone.
   */
  const registeredForRep = useRef<string | null>(null);
  useEffect(() => {
    if (!config) return;
    if (registeredForRep.current === repId) return;
    registeredForRep.current = repId;
    register();
  }, [config, repId, register]);

  const unregister = useCallback(() => {
    try {
      plivoRef.current?.client?.logout?.();
    } catch {
      /* ignore */
    }
    plivoRef.current = null;
    registerInFlight.current = false;
    setPhone({ kind: 'offline' });
    api.setPresence(repId, false).catch(() => undefined);
  }, [repId]);

  // ------------------------------------------------------------- actions
  const callLead = useCallback(
    async (lead: Lead, outcome: 'answer' | 'no-answer' | 'busy' = 'answer') => {
      if (phoneRef.current.kind !== 'ready') return;
      setError(null);

      if (config?.live && plivoRef.current) {
        setPhone({ kind: 'dialing', lead, callUuid: '' });
        plivoRef.current.client.call(lead.phone.replace('+', ''), {
          'X-PH-LeadId': lead.id,
          'X-PH-RepId': repId,
        });
        return;
      }

      const res = await api.simOutbound(repId, { leadId: lead.id }, outcome);
      setPhone({ kind: 'dialing', lead, callUuid: res.callUuid });
    },
    [config, repId],
  );

  /**
   * Dial a typed number. Same path as callLead, minus the CRM record: the
   * destination is whatever the rep entered.
   */
  const callNumber = useCallback(
    async (number: string, outcome: 'answer' | 'no-answer' | 'busy' = 'answer') => {
      if (phoneRef.current.kind !== 'ready') return;
      setError(null);

      const placeholder = {
        id: '',
        name: number,
        company: 'Dialled number',
        phone: number,
        email: '',
        stage: 'new',
        value: 0,
        ownerId: repId,
        lastContactedAt: null,
      } as Lead;

      if (config?.live && plivoRef.current) {
        setPhone({ kind: 'dialing', lead: placeholder, callUuid: '' });
        plivoRef.current.client.call(number.replace('+', ''), { 'X-PH-RepId': repId });
        return;
      }

      const res = await api.simOutbound(repId, { to: number }, outcome);
      setPhone({ kind: 'dialing', lead: placeholder, callUuid: res.callUuid });
    },
    [config, repId],
  );

  /** Delete a call and everything derived from it. */
  const deleteCall = useCallback(
    async (callUuid: string) => {
      try {
        const res = await api.deleteCall(callUuid);
        setTranscripts((prev) => {
          const next = { ...prev };
          delete next[callUuid];
          return next;
        });
        setAnalyses((prev) => {
          const next = { ...prev };
          delete next[callUuid];
          return next;
        });
        pushToast(
          'success',
          'Call deleted',
          res.audioDeleted ? 'The recording was removed too.' : 'Records removed.',
        );
        await refresh();
        await refreshRecordings();
        return true;
      } catch (e: any) {
        pushToast('error', 'Could not delete the call', e?.message ?? 'Request failed');
        return false;
      }
    },
    [pushToast, refresh, refreshRecordings],
  );

  const answerIncoming = useCallback(async () => {
    const cur = phoneRef.current;
    if (cur.kind !== 'ringing-in') return;

    if (config?.live) {
      try {
        plivoRef.current?.client?.answer();
      } catch (e: any) {
        // No live session behind the ring (stale popup, or the caller gave up).
        pushToast('warn', 'Call no longer available', 'The caller hung up.');
        setPhone({ kind: 'ready' });
      }
      return;
    }
    await api.simAnswerIncoming(cur.callUuid);
  }, [config]);

  const hangup = useCallback(async () => {
    const cur = phoneRef.current;
    const duration = cur.kind === 'in-call' ? Math.floor((Date.now() - cur.startedAt) / 1000) : 0;

    if (config?.live) {
      try {
        // An unanswered incoming call is rejected, not hung up.
        if (cur.kind === 'ringing-in') plivoRef.current?.client?.reject();
        else plivoRef.current?.client?.hangup();
      } catch {
        /* nothing live to end */
      }
      if (cur.kind === 'ringing-in') setPhone({ kind: 'ready' });
      return;
    }
    if (cur.kind === 'in-call' || cur.kind === 'dialing' || cur.kind === 'ringing-in') {
      await api.simHangup(cur.callUuid, duration, duration > 0 ? 'completed' : 'no-answer');
    }
  }, [config]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (config?.live && plivoRef.current) {
        next ? plivoRef.current.client.mute() : plivoRef.current.client.unmute();
      }
      return next;
    });
  }, [config]);

  const submitDisposition = useCallback(
    async (disposition: Disposition, notes?: string) => {
      const cur = phoneRef.current;
      if (cur.kind !== 'wrap-up') return;

      if (!cur.callUuid) {
        // The hangup webhook has not reached us yet, so there is no call to
        // attach this to. Saying so beats a silent 404.
        pushToast(
          'warn',
          'Still logging the call',
          'Give it a moment and pick an outcome again.',
        );
        return;
      }

      try {
        await api.setDisposition(cur.callUuid, disposition, notes);
        pushToast('success', 'Outcome saved', disposition.replace('_', ' '));
      } catch (e: any) {
        pushToast('error', 'Could not save the outcome', e?.message ?? 'Request failed');
        return;
      }
      setPhone({ kind: 'ready' });
      setMuted(false);
      await refresh();
    },
    [refresh, pushToast],
  );

  const skipDisposition = useCallback(() => {
    setPhone({ kind: 'ready' });
    setMuted(false);
  }, []);

  /** Demo control: pretend a lead dials your Plivo number. */
  const simulateInbound = useCallback(async (from: string) => {
    await api.simInbound({ from });
  }, []);

  const clearWire = useCallback(async () => {
    await api.clearWire();
    setWire([]);
  }, []);

  return {
    config,
    reps,
    leads,
    calls,
    activities,
    wire,
    rep,
    repId,
    setRepId,
    phone,
    elapsed,
    muted,
    error,
    register,
    unregister,
    callLead,
    callNumber,
    answerIncoming,
    hangup,
    toggleMute,
    submitDisposition,
    skipDisposition,
    simulateInbound,
    clearWire,
    recordings,
    refreshRecordings,
    transcripts,
    transcribing,
    transcription,
    loadTranscript,
    requestTranscript,
    analyses,
    analysing,
    analysisConfig,
    loadAnalysis,
    requestAnalysis,
    deleteCall,
    toasts,
    pushToast,
    dismissToast,
    refresh,
  };
}
