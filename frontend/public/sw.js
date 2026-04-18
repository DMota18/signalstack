/**
 * SignalStack — Push Notification Service Worker
 *
 * Handles incoming push events and notification click actions.
 * Registered by the main app on load.
 */

/* eslint-disable no-restricted-globals */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'SignalStack',
      body: event.data.text(),
    };
  }

  const title = payload.title || 'SignalStack';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: {
      url: payload.url || payload.data?.url || '/app',
      type: payload.data?.type || 'alert',
    },
    tag: payload.data?.type || 'signalstack-notification',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/app';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new tab
      return self.clients.openWindow(url);
    })
  );
});

// Keep service worker alive for push
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
