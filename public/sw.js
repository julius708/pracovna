/*
 * Service worker of LIVE-IN Práčovňa: shows the push notifications the sync
 * sends (early arrivals from Guesty) and opens the board when one is tapped.
 * No caching: the app itself is always loaded fresh.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'LIVE-IN Práčovňa';
  const options = {
    body: data.body || '',
    icon: '/pracovna/icons/icon-192.png',
    badge: '/pracovna/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/pracovna/' },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// the push service rotated the subscription: subscribe again and store the new one under the signed-in user
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription || null;
  const key = (old && old.options && old.options.applicationServerKey) || (event.newSubscription && event.newSubscription.options && event.newSubscription.options.applicationServerKey) || null;
  event.waitUntil(
    (async () => {
      const sub = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!sub) return;
      const json = sub.toJSON();
      await fetch('/pracovna/api/push/subscription', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, oldEndpoint: old ? old.endpoint : null }),
      });
    })().catch(() => {}),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/pracovna/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
