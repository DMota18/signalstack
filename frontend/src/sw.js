/**
 * SignalStack — Service Worker
 *
 * Two jobs:
 *   1. Precache the app shell (workbox, injected at build time) so the
 *      app opens offline with the last-cached data.
 *   2. Handle Web Push events and notification clicks.
 *
 * Registered on app load from main.tsx (virtual:pwa-register).
 */

/* global self */

import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

self.skipWaiting();
clientsClaim();

// ── App shell precache ──────────────────────────────────────────────────────

precacheAndRoute(self.__WB_MANIFEST);

// SPA navigations serve the cached index.html; API calls pass through.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  })
);

// ── Web Push ────────────────────────────────────────────────────────────────

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

  event.waitUntil(self.registration.showNotification(title, options));
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
