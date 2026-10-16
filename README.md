# inMind

A fresh, public-first website for GitHub Pages. Visitors can tour the spaces, use the Mindcosmos breathing, grounding, and quiet-light activities, and read the public blog without an account. Signing in is reserved for personal MySpace saves and Social posting or following.

## Files

- `index.html` — page content and account dialog
- `styles.css` — responsive, minimal interface
- `app.js` — public interactions, Firebase Authentication, and Firestore sync
- `firebase-config.js` — Firebase web configuration placeholders
- `firestore.rules` — owner-only private data plus public profiles and posts

## Connect the existing Firebase project

1. In Firebase Console, open **Project settings → General → Your apps** and copy the web app configuration into `firebase-config.js`.
2. Enable **Email/Password** under **Authentication → Sign-in method**.
3. In **Authentication → Settings → Authorized domains**, add the GitHub Pages host.
4. Publish `firestore.rules` in **Firestore Database → Rules**. Review any existing rules first and merge other required app paths deliberately. Publishing rules changes access permissions; it does not delete Firestore documents.

The new MySpace reads existing private entries under `users/{uid}/entries` and displays legacy title/body notes without migrating or deleting them. New goals and thoughts use the same private per-user path. Social profiles contain only a public display name; posts are public, and following lists are private.

## Publish on GitHub Pages

Put these files in the root of the existing website repository, then enable GitHub Pages for that branch and folder. Open the published HTTPS address to use Firebase modules and Authentication. `index.html` opened as a local file does not provide the secure web origin Firebase requires.

The supplied Firebase config contains placeholders, so account creation, posts, following, and cross-device sync remain unavailable until the real web configuration and Firestore rules are connected. The public tour and Mindcosmos activities work without them. Never put a Firebase service-account key in this site.
