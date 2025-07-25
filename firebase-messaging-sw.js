importScripts('https://www.gstatic.com/firebasejs/9.6.10/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.10/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyBpjFp4K85W7-_dCkeCHpljH6ugd7e7NNk",
  authDomain: "womensafetyapp-1afdd.firebaseapp.com",
  projectId: "womensafetyapp-1afdd",
  storageBucket: "womensafetyapp-1afdd.appspot.com",
  messagingSenderId: "637704780656",
  appId: "1:637704780656:web:931791fb0e8d48c2ab2db5"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png'  // optional: replace with your own icon if available
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
