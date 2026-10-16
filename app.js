import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = (selector) => document.querySelector(selector);
const authDialog = $('#authDialog');
const composeDialog = $('#composeDialog');
const toast = $('#toast');
let authMode = 'signup';
let pendingArea = null;
let signedInUser = null;
let unsubscribeEntries = null;
let toastTimer;

const areaInfo = {
  mindcosmos: { label: 'MINDCOSMOS', title: 'A thought to keep.', description: 'Write something for yourself. It will be saved privately to your account.', placeholder: 'What is on your mind?', private: true },
  social: { label: 'SOCIAL', title: 'Share a little moment.', description: 'This starter site saves your note privately. A public community feed needs additional moderation and privacy features.', placeholder: 'What would you like to remember?', private: true },
  myspace: { label: 'MYSPACE', title: 'A space that feels like you.', description: 'Start with a short note about yourself. Your profile draft is saved privately.', placeholder: 'A little about you…', private: true },
  blogs: { label: 'BLOGS', title: 'A story in progress.', description: 'Write a draft and find it here next time you sign in. Your writing stays private.', placeholder: 'Start wherever you are…', private: true }
};

$('#year').textContent = new Date().getFullYear();

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

function openAuth(mode = 'signup') {
  setAuthMode(mode);
  authDialog.showModal();
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tabs button').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('#authTitle').textContent = mode === 'signup' ? 'Make it yours.' : 'Welcome back.';
  $('#authEyebrow').textContent = mode === 'signup' ? 'YOUR SPACE IS WAITING' : 'GOOD TO SEE YOU';
  $('#authCopy').textContent = mode === 'signup' ? 'Create an account to save your thoughts and pick up wherever you left off.' : 'Log in to find your spaces just as you left them.';
  $('#authSubmit').innerHTML = mode === 'signup' ? 'Create account <span>↗</span>' : 'Log in <span>↗</span>';
  $('#passwordInput').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
}

function openCompose(area) {
  const info = areaInfo[area];
  if (!info) return;
  pendingArea = area;
  $('#composeKicker').textContent = info.label;
  $('#composeTitle').textContent = info.title;
  $('#composeDescription').textContent = info.description;
  $('#entryBody').placeholder = info.placeholder;
  $('#entryTitle').value = '';
  $('#entryBody').value = '';
  composeDialog.showModal();
}

document.querySelectorAll('[data-auth]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.auth)));
$('#signInTop').addEventListener('click', () => openAuth('login'));
$('#joinTop').addEventListener('click', () => openAuth('signup'));
document.querySelectorAll('.auth-tabs button').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.mode)));
$('#closeDialog').addEventListener('click', () => authDialog.close());
$('#closeCompose').addEventListener('click', () => composeDialog.close());
document.querySelectorAll('[data-protected]').forEach(button => button.addEventListener('click', () => {
  const area = button.dataset.protected;
  if (signedInUser) openCompose(area);
  else { pendingArea = area; openAuth('signup'); }
}));

$('#privacyLink').addEventListener('click', () => showToast('Your entries are private to your account. You can review the included Firestore rules before deploying.'));
$('#accountButton').addEventListener('click', async () => {
  if (signedInUser && confirm(`Log out ${signedInUser.email}?`)) {
    try { await signOut(auth); showToast('You are logged out. See you soon.'); }
    catch { showToast('Could not log out. Please try again.'); }
  }
});

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!auth) { showToast('Add your Firebase web config in firebase-config.js first.'); return; }
  const email = $('#emailInput').value.trim();
  const password = $('#passwordInput').value;
  const submit = $('#authSubmit');
  submit.disabled = true;
  try {
    if (authMode === 'signup') await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
    authDialog.close();
    showToast(authMode === 'signup' ? 'Your account is ready. Welcome to inMind.' : 'You are back in your space.');
    if (pendingArea) { const area = pendingArea; pendingArea = null; openCompose(area); }
  } catch (error) {
    showToast(authMessage(error.code));
  } finally { submit.disabled = false; }
});

$('#composeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!signedInUser || !db || !pendingArea) { showToast('Log in to save your space.'); composeDialog.close(); return; }
  const saveButton = $('#composeForm button[type="submit"]');
  saveButton.disabled = true;
  try {
    await addDoc(collection(db, 'users', signedInUser.uid, 'entries'), {
      area: pendingArea,
      title: $('#entryTitle').value.trim(),
      body: $('#entryBody').value.trim(),
      createdAt: serverTimestamp()
    });
    composeDialog.close();
    showToast('Saved privately to your inMind account.');
  } catch (error) {
    showToast(error.code === 'permission-denied' ? 'Firestore rules blocked this save. Publish the included rules in Firebase.' : 'Could not save right now. Check your Firebase setup and try again.');
  } finally { saveButton.disabled = false; }
});

function authMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'That email already has an account. Try logging in.',
    'auth/invalid-credential': 'Email or password did not match. Please try again.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a little and try again.',
    'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication.'
  };
  return messages[code] || `Could not sign in (${code || 'unknown error'}). Check your Firebase setup.`;
}

function renderEntries(entries) {
  document.querySelectorAll('.account-entries').forEach(node => node.remove());
  if (!entries.length) return;
  const groups = new Map();
  for (const entry of entries) {
    if (!areaInfo[entry.area]) continue;
    if (!groups.has(entry.area)) groups.set(entry.area, []);
    groups.get(entry.area).push(entry);
  }
  for (const [area, items] of groups) {
    const card = document.querySelector(`#${area} .space-content`);
    if (!card) continue;
    const wrap = document.createElement('div');
    wrap.className = 'account-entries';
    const label = document.createElement('p');
    label.className = 'entry-private-label';
    label.textContent = 'YOUR PRIVATE NOTES';
    wrap.append(label);
    for (const item of items) {
      const entry = document.createElement('article');
      entry.className = 'saved-entry';
      const title = document.createElement('strong');
      title.textContent = item.title || 'Untitled';
      const body = document.createElement('p');
      body.textContent = item.body || '';
      entry.append(title, body);
      wrap.append(entry);
    }
    const link = card.querySelector('.arrow-link');
    card.insertBefore(wrap, link);
  }
}

function initializeFirebase() {
  const ready = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE_') && firebaseConfig.projectId && firebaseConfig.projectId !== 'YOUR_PROJECT_ID';
  if (!ready) return { auth: null, db: null };
  try {
    const app = initializeApp(firebaseConfig);
    return { auth: getAuth(app), db: getFirestore(app) };
  } catch (error) {
    console.error('Firebase setup error:', error);
    showToast('Firebase config could not be loaded. Check firebase-config.js.');
    return { auth: null, db: null };
  }
}

const { auth, db } = initializeFirebase();
if (auth) {
  onAuthStateChanged(auth, user => {
    signedInUser = user;
    $('#signInTop').classList.toggle('hidden', Boolean(user));
    $('#joinTop').classList.toggle('hidden', Boolean(user));
    $('#accountButton').classList.toggle('hidden', !user);
    if (user) {
      $('#accountButton').textContent = (user.email || 'Y').charAt(0).toUpperCase();
      if (unsubscribeEntries) unsubscribeEntries();
      const entriesQuery = query(collection(db, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'), limit(40));
      unsubscribeEntries = onSnapshot(entriesQuery, snapshot => renderEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))), error => {
        console.error('Entry sync error:', error);
        showToast('Could not sync your private notes. Check your Firestore rules.');
      });
    } else {
      if (unsubscribeEntries) unsubscribeEntries();
      unsubscribeEntries = null;
      renderEntries([]);
    }
  });
}
