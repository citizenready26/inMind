# inMind — GitHub Pages starter

A public-first, responsive website for inMind. Visitors can explore the Mindcosmos, Social, MySpace, and Blogs previews without an account. Email/password sign-up is requested only when someone tries to create or save something. Signed-in users' entries are stored privately in Firestore and sync across their devices.

## Files

- `index.html` — page content and dialogs
- `styles.css` — responsive design
- `app.js` — interactions, Firebase Authentication, and Firestore sync
- `firebase-config.js` — public Firebase web app configuration placeholders
- `firestore.rules` — owner-only rules for user entries

## Set up Firebase

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/).
2. In **Project settings → General → Your apps**, register a Web app and copy its config object into `firebase-config.js`, replacing every placeholder. The Firebase web config is designed to be included in a website; do not put service account keys or private credentials in this file.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. In **Firestore Database**, create a database. Choose a location close to your users.
5. Open the Firestore **Rules** tab, replace its contents with `firestore.rules`, and publish.
6. In **Authentication → Settings → Authorized domains**, add your GitHub Pages host (for example, `yourname.github.io`).

## Publish on GitHub Pages

1. Copy the contents of this folder into the root of your GitHub repository, keeping all five files together.
2. Commit and push the files.
3. In the repository, open **Settings → Pages**. Choose **Deploy from a branch**, select your website branch and `/ (root)`, then save.
4. Open the published Pages URL over HTTPS. Firebase Authentication and the ES module imports require a web server; opening `index.html` directly as a local file will not work.

## Privacy and scope

The included Firestore rules let each authenticated user read and change only `users/{their uid}/entries/*`. All other paths are denied. The starter stores notes, drafts, and space entries privately. The Social preview is sample content; it does not publish user posts or implement a shared community feed. A real public feed should add moderation, reporting, rate limiting, and carefully scoped public-read rules before launch.

There are no server credentials in this project. Do not paste Firebase service-account JSON or Admin SDK keys into the repository. Firebase web configuration is public by design; use Firebase Authentication, Firestore rules, and Firebase App Check (recommended before a public launch) to protect your project.
