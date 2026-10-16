'use client';

import { useEffect, useState } from 'react';
import { removePushSubscriptionAction, savePushSubscriptionAction } from '@/app/_lib/push-actions';
import { sk } from '@/core/i18n/sk';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? '';

type State = 'checking' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'blocked' | 'busy';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!PUBLIC_KEY;
}

/** iPhone/iPad Safari only sends push to an app added to the home screen. */
function iosNeedsInstall(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/**
 * "🔔 Upozornenia": turns push notifications on or off for this device (owner,
 * 2026-10-11: an early arrival must show up as a notification). The subscription
 * is stored under the signed-in user; the sync sends to every subscribed device.
 */
export function PushToggle() {
  const [state, setState] = useState<State>('checking');
  const [hint, setHint] = useState<string | null>(null);
  const t = sk.push;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported()) {
        setState(typeof window !== 'undefined' && iosNeedsInstall() ? 'ios-install' : 'unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('blocked');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(sub ? 'on' : 'off');
        // the push service may have rotated the subscription: keep the stored one current
        const json = sub?.toJSON();
        if (sub && json?.endpoint && json.keys?.p256dh && json.keys?.auth) {
          void savePushSubscriptionAction({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, navigator.userAgent);
        }
      } catch {
        if (!cancelled) setState('off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setState('busy');
    setHint(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('subscription incomplete');
      const res = await savePushSubscriptionAction({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, navigator.userAgent);
      if (!res.ok) throw new Error(res.error ?? 'failed');
      setState('on');
      setHint(t.enabledHint);
    } catch {
      setState('off');
      setHint(t.failed);
    }
  };

  const disable = async () => {
    setState('busy');
    setHint(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      setState('on');
      setHint(t.failed);
    }
  };

  if (state === 'checking' || state === 'unsupported') return null;
  if (state === 'ios-install') {
    return (
      <span className="push ios">
        <b>🔔 {t.iosShort}</b>
        <small className="push-hint">{t.iosHint}</small>
      </span>
    );
  }
  if (state === 'blocked') {
    return (
      <span className="push blocked">
        <b>🔕 {t.blocked}</b>
        <small className="push-hint">{t.blockedHint}</small>
      </span>
    );
  }
  const on = state === 'on';
  return (
    <span className="push">
      <button type="button" className={`push-btn${on ? ' on' : ''}`} disabled={state === 'busy'} onClick={() => void (on ? disable() : enable())} aria-pressed={on} title={on ? t.onHint : t.offHint}>
        {on ? `🔔 ${t.on}` : `🔔 ${t.off}`}
      </button>
      {hint && <small className="push-hint">{hint}</small>}
    </span>
  );
}
