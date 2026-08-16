/* ==========================================================================
   GeoFinance System — Configuration Firebase (sauvegarde cloud optionnelle)
   Ces valeurs ne sont PAS secrètes : elles identifient le projet Firebase,
   elles n'authentifient rien. La sécurité réelle vient des règles Firestore
   (accès restreint à chaque utilisateur pour son propre document, voir
   CLAUDE.md) et de Firebase Authentication, pas de la confidentialité de cet
   objet — il est normal et attendu qu'il soit visible dans le code source
   public d'une app cliente. À remplacer par les valeurs de ton projet :
   console.firebase.google.com > Paramètres du projet > Général > Vos
   applications > Ajouter une app Web.
   ========================================================================== */

export const firebaseConfig = {
  apiKey: 'AIzaSyAg5BqRaVOV0QCqrRx0rV0JwuC8XS67-jg',
  authDomain: 'geofinance-backup.firebaseapp.com',
  projectId: 'geofinance-backup',
  storageBucket: 'geofinance-backup.firebasestorage.app',
  messagingSenderId: '868830301244',
  appId: '1:868830301244:web:715281871daba9a49c8739',
};

/** true tant que la config n'a pas été renseignée : permet à firebase-sync.js d'afficher un
    message clair ("fonctionnalité pas encore configurée") plutôt que d'échouer silencieusement
    ou avec une erreur réseau confuse au moment de la connexion. */
export const isFirebaseConfigured = Object.values(firebaseConfig).every((v) => v && v !== 'REPLACE_ME');

/** ID du client OAuth Google auto-créé par Firebase quand le fournisseur Google a été activé
    (Firebase Console > Authentication > Sign-in method > Google > "Configuration du SDK Web" —
    identique à celui visible dans Google Cloud Console > APIs et services > Identifiants > "Web
    client (auto created by Google Service)"). Utilisé directement par Google Identity Services
    (firebase-sync.js) — voir CLAUDE.md pour le contexte : signInWithPopup/signInWithRedirect de
    Firebase dépendent d'un pont de stockage tiers entre ce site et geofinance-backup.firebaseapp.com
    qui échoue sur les navigateurs mobiles à stockage cloisonné (Safari, Chrome/Android). Google
    Identity Services contourne ce pont entièrement en récupérant un jeton d'accès directement,
    échangé ensuite contre une session Firebase via signInWithCredential — pas secret, même
    raisonnement que firebaseConfig ci-dessus. IMPORTANT : ce client OAuth doit avoir
    `https://zaky04.github.io` dans ses "Authorized JavaScript origins" (Google Cloud Console >
    Identifiants > ce client) pour que Google Identity Services accepte les appels depuis ce site. */
export const googleClientId = '868830301244-a57es0a6hebp31s5ppnp2d14p7nfk49h.apps.googleusercontent.com';
