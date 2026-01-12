// sw.js - Service Worker for QuikChat PWA
const CACHE_NAME = 'quikchat-v3.0.0';
const STATIC_CACHE = 'quikchat-static-v3';
const DYNAMIC_CACHE = 'quikchat-dynamic-v3';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-192x192.png',
  '/icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap',
  '/socket.io/socket.io.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-storage-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[Service Worker] Caching static assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[Service Worker] Skip waiting');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension requests
  if (requestUrl.protocol === 'chrome-extension:') {
    return;
  }
  
  // Skip socket.io and Firebase connections
  if (
    requestUrl.pathname.includes('/socket.io/') ||
    requestUrl.hostname.includes('firebase') ||
    requestUrl.hostname.includes('googleapis') ||
    requestUrl.hostname.includes('gstatic')
  ) {
    // Network only for real-time connections
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Cache strategy: Network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If we got a valid response, cache it
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // If not in cache, return offline page for HTML requests
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/offline.html');
            }
            
            // Return fallback for other requests
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received');
  
  let data = {
    title: 'New Message',
    body: 'You have a new message on QuikChat',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png'
  };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon || '/icon-192x192.png',
    badge: data.badge || '/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1',
      url: data.url || '/'
    },
    actions: [
      {
        action: 'open',
        title: 'Open Chat'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click received');
  
  event.notification.close();
  
  if (event.action === 'open') {
    // Open the app
    event.waitUntil(
      clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url || '/');
        }
      })
    );
  }
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
  
  if (event.tag === 'sync-images') {
    event.waitUntil(syncImages());
  }
});

// Sync messages when back online
async function syncMessages() {
  try {
    const db = await openIndexedDB();
    const messages = await getAllFromIndexedDB(db, 'messages');
    
    for (const message of messages) {
      // Send message to server
      const response = await fetch('/api/messages/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });
      
      if (response.ok) {
        // Remove from IndexedDB
        await deleteFromIndexedDB(db, 'messages', message.id);
      }
    }
    
    console.log('[Service Worker] Messages synced');
  } catch (error) {
    console.error('[Service Worker] Sync error:', error);
  }
}

// Sync images when back online
async function syncImages() {
  try {
    const db = await openIndexedDB();
    const images = await getAllFromIndexedDB(db, 'images');
    
    for (const image of images) {
      const formData = new FormData();
      formData.append('image', image.blob, image.filename);
      formData.append('metadata', JSON.stringify(image.metadata));
      
      const response = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        await deleteFromIndexedDB(db, 'images', image.id);
      }
    }
    
    console.log('[Service Worker] Images synced');
  } catch (error) {
    console.error('[Service Worker] Image sync error:', error);
  }
}

// IndexedDB helper functions
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('QuikChatDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create object stores
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
    };
  });
}

function getAllFromIndexedDB(db, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function deleteFromIndexedDB(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Periodically clean old data
setInterval(async () => {
  try {
    const db = await openIndexedDB();
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    // Clean old messages
    const messages = await getAllFromIndexedDB(db, 'messages');
    for (const message of messages) {
      if (message.timestamp < weekAgo) {
        await deleteFromIndexedDB(db, 'messages', message.id);
      }
    }
    
    // Clean old images
    const images = await getAllFromIndexedDB(db, 'images');
    for (const image of images) {
      if (image.timestamp < weekAgo) {
        await deleteFromIndexedDB(db, 'images', image.id);
      }
    }
    
    console.log('[Service Worker] Cleaned old data');
  } catch (error) {
    console.error('[Service Worker] Cleanup error:', error);
  }
}, 24 * 60 * 60 * 1000); // Daily

// Handle periodic sync for updates
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-check') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match('/version.txt');
    
    if (!cachedResponse) return;
    
    const cachedVersion = await cachedResponse.text();
    const networkResponse = await fetch('/version.txt');
    
    if (networkResponse.ok) {
      const networkVersion = await networkResponse.text();
      
      if (cachedVersion !== networkVersion) {
        // New version available
        self.registration.showNotification('Update Available', {
          body: 'A new version of QuikChat is available. Refresh to update.',
          icon: '/icon-192x192.png',
          tag: 'update-available',
          requireInteraction: true,
          actions: [
            {
              action: 'refresh',
              title: 'Refresh'
            },
            {
              action: 'dismiss',
              title: 'Dismiss'
            }
          ]
        });
      }
    }
  } catch (error) {
    console.error('[Service Worker] Update check error:', error);
  }
    }
