/* ============================================================
   Baked-in Firebase config — OPTIONAL convenience.
   When `databaseURL` below is filled in, EVERY device that opens
   this app auto-connects to the same live game (no manual setup).
   Leave the placeholder and the app stays offline until someone
   pastes a config via the connection chip.

   ➜ TO FINISH: create a Realtime Database (Firebase console →
     Build → Realtime Database → Create → Singapore → test mode),
     copy the URL it shows, and paste it as `databaseURL` below.
   ============================================================ */
window.JETLAG_FIREBASE = {
  enabled: true,
  room: "hk-game",                       // everyone on this URL shares this room
  config: {
    apiKey: "AIzaSyB-Ie0KC8VPC-LE5BxmL0eJaeW8AHpNA3Y",
    authDomain: "jet-lag-the-game-hongkong.firebaseapp.com",
    databaseURL: "https://jet-lag-the-game-hongkong-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "jet-lag-the-game-hongkong",
    storageBucket: "jet-lag-the-game-hongkong.firebasestorage.app",
    messagingSenderId: "90095081149",
    appId: "1:90095081149:web:f737012e1613d59ef249d4"
  }
};
