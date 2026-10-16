import { firebaseConfig } from './firebase-config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authDialog = $('#authDialog');
const toast = $('#toast');
const authForm = $('#authForm');

let firebaseStatus = 'loading';
let auth = null;
let db = null;
let currentUser = null;
let authMode = 'signup';
let pendingIntent = null;
let preferredProfileName = '';
let toastTimer;
let privateUnsubscribers = [];
let publicUnsubscribe = null;
let directoryUnsubscribe = null;
let followingIds = new Set();
let profiles = [];

const firebaseConfigReady = Boolean(
  firebaseConfig?.apiKey && !firebaseConfig.apiKey.startsWith('PASTE_') &&
  firebaseConfig?.projectId && firebaseConfig.projectId !== 'YOUR_PROJECT_ID' &&
  firebaseConfig?.appId && firebaseConfig.appId !== 'YOUR_FIREBASE_APP_ID'
);

$('#year').textContent = new Date().getFullYear();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
}

function setAuthMode(mode) {
  authMode = mode;
  $$('.auth-tabs button').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const isSignup = mode === 'signup';
  $('#displayNameLabel').classList.toggle('hidden', !isSignup);
  $('#displayNameInput').required = isSignup;
  $('#displayNameInput').autocomplete = isSignup ? 'nickname' : 'off';
  $('#authTitle').textContent = isSignup ? 'Make it yours.' : 'Welcome back.';
  $('#authEyebrow').textContent = isSignup ? 'YOUR SPACE, WHEN YOU’RE READY' : 'GOOD TO SEE YOU AGAIN';
  $('#authSubmit').innerHTML = isSignup ? 'Create account <span aria-hidden="true">↗</span>' : 'Log in <span aria-hidden="true">↗</span>';
  $('#passwordInput').autocomplete = isSignup ? 'new-password' : 'current-password';
  updateAuthAvailability();
}

function updateAuthAvailability() {
  const copy = {
    loading: 'Checking account services… You can explore the public spaces while we check.',
    missing: 'Account creation and syncing need the site’s Firebase web configuration. The public tour is ready to explore.',
    error: 'The account service could not start. Check the Firebase configuration and try again.',
    ready: authMode === 'signup'
      ? 'Your account saves your private notes and lets you join the community.'
      : 'Log in to find your private space and saved progress.'
  };
  $('#authCopy').textContent = copy[firebaseStatus] || copy.error;
  $('#authSubmit').disabled = firebaseStatus !== 'ready';
  $('#emailInput').disabled = firebaseStatus !== 'ready';
  $('#passwordInput').disabled = firebaseStatus !== 'ready';
  $('#displayNameInput').disabled = firebaseStatus !== 'ready';
  $('#resetPassword').disabled = firebaseStatus !== 'ready';
}

function openAuth(mode = 'signup', intent = null) {
  pendingIntent = intent;
  setAuthMode(mode);
  if (!authDialog.open) authDialog.showModal();
}

$$('[data-auth]').forEach(button => button.addEventListener('click', () => {
  if (currentUser) {
    const target = button.dataset.memberTarget;
    if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
    else showToast('You’re already signed in. Your spaces are ready below.');
    return;
  }
  openAuth(button.dataset.auth || 'signup');
}));

$('#loginTop').addEventListener('click', () => openAuth('login'));
$('#signupTop').addEventListener('click', () => openAuth('signup'));
$$('.auth-tabs button').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.mode)));
$('#closeAuth').addEventListener('click', () => authDialog.close());
authDialog.addEventListener('click', event => {
  if (event.target === authDialog) authDialog.close();
});

$('#accountButton').addEventListener('click', async () => {
  if (!auth || !currentUser) return;
  try {
    await auth.signOut();
    showToast('You’re signed out. Your private space will be here when you return.');
  } catch {
    showToast('Could not sign out right now. Please try again.');
  }
});

$('#resetPassword').addEventListener('click', async () => {
  if (!auth || !$('#emailInput').value.trim()) {
    showToast('Enter your email address first.');
    return;
  }
  try {
    await auth.sendPasswordResetEmail($('#emailInput').value.trim());
    showToast('If an account uses that email, a reset link is on its way.');
  } catch (error) {
    showToast(authErrorMessage(error.code));
  }
});

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (firebaseStatus !== 'ready' || !auth) return;
  const email = $('#emailInput').value.trim();
  const password = $('#passwordInput').value;
  const name = $('#displayNameInput').value.trim().replace(/\s+/g, ' ');
  if (authMode === 'signup' && name.length < 2) {
    showToast('Choose a name with at least two characters.');
    return;
  }
  const submit = $('#authSubmit');
  submit.disabled = true;
  preferredProfileName = name;
  try {
    if (authMode === 'signup') {
      const result = await auth.createUserWithEmailAndPassword(email, password);
      await ensureProfile(result.user, name);
      showToast('Your account is ready. Welcome to inMind.');
    } else {
      await auth.signInWithEmailAndPassword(email, password);
      showToast('You’re back in your space.');
    }
    authDialog.close();
    const intent = pendingIntent;
    pendingIntent = null;
    if (intent) setTimeout(() => resumeIntent(intent), 250);
  } catch (error) {
    showToast(authErrorMessage(error.code));
  } finally {
    preferredProfileName = '';
    updateAuthAvailability();
  }
});

function authErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'That email already has an account. Try logging in.',
    'auth/invalid-credential': 'Email or password did not match. Please try again.',
    'auth/weak-password': 'Choose a password with at least six characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a little and try again.',
    'auth/operation-not-allowed': 'Email and password sign-in is not enabled in Firebase.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your connection and try again.'
  };
  return messages[code] || 'Could not complete that account action. Check the Firebase setup and try again.';
}

function safeDisplayName(value, email = '') {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (name.length >= 2) return name;
  const fallback = (email.split('@')[0] || 'inMind member').slice(0, 32);
  return fallback.length >= 2 ? fallback : 'inMind member';
}

async function ensureProfile(user, preferredName = '') {
  const profileRef = db.doc(db.firestore, 'users', user.uid);
  const existing = await db.getDoc(profileRef);
  if (!existing.exists()) {
    await db.setDoc(profileRef, {
      displayName: safeDisplayName(preferredName || user.displayName, user.email || ''),
      joinedAt: db.serverTimestamp()
    });
  }
}

function stopListeners() {
  privateUnsubscribers.forEach(unsubscribe => unsubscribe());
  privateUnsubscribers = [];
}

function startPrivateListeners(user) {
  const entries = db.query(
    db.collection(db.firestore, 'users', user.uid, 'entries'),
    db.orderBy('createdAt', 'desc'),
    db.limit(60)
  );
  privateUnsubscribers.push(db.onSnapshot(entries, snapshot => {
    const rows = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderGoals(rows.filter(item => item.type === 'goal'));
    // Show older private entries from the supplied starter without changing or migrating them.
    renderNotes(rows.filter(item => item.type === 'note' || (!item.type && typeof item.body === 'string')));
    $('#syncStatus').textContent = 'Saved to your account · syncing across your devices';
    $('#myspaceStatus').textContent = 'Private to you';
  }, error => {
    console.error('MySpace sync failed:', error);
    $('#syncStatus').textContent = 'Could not sync. Check the published Firestore rules.';
    showToast('Your private space could not sync. Check the Firebase rules.');
  }));
}

function renderGoals(goals) {
  const list = $('#goalList');
  list.replaceChildren();
  if (!goals.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-small';
    empty.textContent = 'Your first goal can be a small one.';
    list.append(empty);
    return;
  }
  goals.forEach(goal => {
    const row = document.createElement('article');
    row.className = 'goal-row';
    const top = document.createElement('div');
    top.className = 'goal-topline';
    const title = document.createElement('span');
    title.textContent = goal.title || 'Untitled goal';
    const count = document.createElement('span');
    count.textContent = `${Math.round(Number(goal.progress) || 0)}%`;
    top.append(title, count);
    const track = document.createElement('div');
    track.className = 'progress-track';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, Number(goal.progress) || 0))}%`;
    track.append(fill);
    const controls = document.createElement('div');
    controls.className = 'goal-controls';
    const minus = makeButton('−', 'Reduce progress', () => changeGoal(goal, Math.max(0, (Number(goal.progress) || 0) - 20)));
    const plus = makeButton('+', 'Mark a little progress', () => changeGoal(goal, Math.min(100, (Number(goal.progress) || 0) + 20)));
    const remove = makeButton('×', `Delete ${goal.title || 'goal'}`, () => removeEntry(goal.id), 'delete-entry');
    controls.append(minus, plus, remove);
    row.append(top, track, controls);
    list.append(row);
  });
}

function renderNotes(notes) {
  const wrap = $('#savedNotes');
  wrap.replaceChildren();
  notes.forEach(note => {
    const card = document.createElement('article');
    card.className = 'saved-note';
    if (note.title && note.title !== 'A thought for today') {
      const title = document.createElement('strong');
      title.textContent = note.title;
      card.append(title);
    }
    const text = document.createElement('p');
    text.textContent = note.body || '';
    const footer = document.createElement('footer');
    const date = document.createElement('span');
    date.textContent = formatDate(note.createdAt);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => removeEntry(note.id));
    footer.append(date, remove);
    card.append(text, footer);
    wrap.append(card);
  });
}

function makeButton(label, accessibleLabel, handler, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', accessibleLabel);
  if (className) button.className = className;
  button.addEventListener('click', handler);
  return button;
}

function formatDate(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date) return 'Just saved';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

async function changeGoal(goal, progress) {
  if (!currentUser || !db) return;
  try {
    await db.updateDoc(db.doc(db.firestore, 'users', currentUser.uid, 'entries', goal.id), {
      progress,
      updatedAt: db.serverTimestamp()
    });
  } catch {
    showToast('Could not update that goal. Check your connection and try again.');
  }
}

async function removeEntry(entryId) {
  if (!currentUser || !db) return;
  try {
    await db.deleteDoc(db.doc(db.firestore, 'users', currentUser.uid, 'entries', entryId));
  } catch {
    showToast('Could not delete that item. Please try again.');
  }
}

function resumeIntent(intent) {
  if (!currentUser || !db) return;
  if (intent.type === 'follow') toggleFollow(intent.userId);
  else if (intent.type === 'share') $('#postInput').focus();
}

$('#goalForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) { openAuth('signup'); return; }
  const title = $('#goalInput').value.trim();
  if (!title) { showToast('Write a goal first.'); return; }
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    await db.addDoc(db.collection(db.firestore, 'users', currentUser.uid, 'entries'), {
      type: 'goal', title, body: '', progress: 0,
      createdAt: db.serverTimestamp(), updatedAt: db.serverTimestamp()
    });
    $('#goalInput').value = '';
    showToast('Goal saved privately.');
  } catch (error) {
    console.error('Goal save failed:', error);
    showToast('Could not save your goal. Check the Firebase rules.');
  } finally { button.disabled = false; }
});

$('#noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) { openAuth('signup'); return; }
  const body = $('#noteInput').value.trim();
  if (!body) { showToast('Write a thought first.'); return; }
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    await db.addDoc(db.collection(db.firestore, 'users', currentUser.uid, 'entries'), {
      type: 'note', title: 'A thought for today', body, progress: 0,
      createdAt: db.serverTimestamp(), updatedAt: db.serverTimestamp()
    });
    $('#noteInput').value = '';
    showToast('Thought saved privately.');
  } catch (error) {
    console.error('Note save failed:', error);
    showToast('Could not save your thought. Check the Firebase rules.');
  } finally { button.disabled = false; }
});

function renderFeed(posts) {
  const list = $('#feedList');
  list.replaceChildren();
  if (!posts.length) {
    list.append(makeEditorialPrompt('What’s one small thing that made today feel a little lighter?', 'A question to sit with'));
    list.append(makeEditorialPrompt('You don’t have to have it all figured out to take the next small step.', 'A gentle reminder'));
    $('#feedStatus').textContent = db ? 'Open to everyone' : 'Community prompts';
    return;
  }
  posts.forEach(post => list.append(makePost(post)));
  $('#feedStatus').textContent = 'Open to everyone';
}

function makeEditorialPrompt(text, label) {
  const article = document.createElement('article');
  article.className = 'feed-post editorial-post';
  const avatar = document.createElement('div');
  avatar.className = 'post-avatar avatar-soft';
  avatar.textContent = 'in';
  const body = document.createElement('div');
  body.className = 'post-body';
  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const name = document.createElement('strong');
  name.textContent = 'inMind';
  const tag = document.createElement('span');
  tag.textContent = label;
  meta.append(name, tag);
  const content = document.createElement('p');
  content.textContent = text;
  const date = document.createElement('span');
  date.className = 'post-date';
  date.textContent = 'A note from inMind';
  body.append(meta, content, date);
  article.append(avatar, body);
  return article;
}

function makePost(post) {
  const article = document.createElement('article');
  article.className = 'feed-post';
  const avatar = document.createElement('div');
  avatar.className = 'post-avatar';
  avatar.textContent = initials(post.authorName);
  const body = document.createElement('div');
  body.className = 'post-body';
  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const name = document.createElement('strong');
  name.textContent = post.authorName || 'inMind member';
  const tag = document.createElement('span');
  tag.textContent = 'Community';
  meta.append(name, tag);
  const content = document.createElement('p');
  content.textContent = post.text || '';
  const date = document.createElement('span');
  date.className = 'post-date';
  date.textContent = formatDate(post.createdAt);
  body.append(meta, content, date);
  article.append(avatar, body);
  if (currentUser && post.authorId === currentUser.uid) {
    const remove = makeButton('×', 'Delete your post', async () => {
      try {
        await db.deleteDoc(db.doc(db.firestore, 'posts', post.id));
        showToast('Post removed.');
      } catch {
        showToast('Could not remove that post. Please try again.');
      }
    }, 'delete-entry');
    article.append(remove);
  }
  return article;
}

function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toLowerCase() || 'in';
}

$('#postForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) { openAuth('signup', { type: 'share' }); return; }
  const text = $('#postInput').value.trim();
  if (!text) { showToast('Write a thought before posting.'); return; }
  if (text.length > 500) { showToast('Keep your post to 500 characters or less.'); return; }
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    const profile = await db.getDoc(db.doc(db.firestore, 'users', currentUser.uid));
    const authorName = profile.data()?.displayName || 'inMind member';
    await db.addDoc(db.collection(db.firestore, 'posts'), {
      authorId: currentUser.uid,
      authorName,
      text,
      createdAt: db.serverTimestamp()
    });
    $('#postInput').value = '';
    showToast('Your post is live in the community.');
  } catch (error) {
    console.error('Post failed:', error);
    showToast('Could not post right now. Check your connection and Firebase rules.');
  } finally { button.disabled = false; }
});

function renderProfiles() {
  const list = $('#profilesList');
  list.replaceChildren();
  const people = profiles.filter(profile => profile.id !== currentUser?.uid).slice(0, 8);
  $('#peopleCount').textContent = people.length ? `${people.length} here` : 'More people soon';
  if (!people.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-small';
    empty.textContent = db ? 'New community members will show up here.' : 'Sign in to connect with people in the community.';
    list.append(empty);
    return;
  }
  people.forEach(profile => {
    const row = document.createElement('div');
    row.className = 'profile-row';
    const avatar = document.createElement('div');
    avatar.className = 'profile-avatar';
    avatar.textContent = initials(profile.displayName);
    const details = document.createElement('div');
    details.className = 'profile-details';
    const name = document.createElement('strong');
    name.textContent = profile.displayName || 'inMind member';
    const caption = document.createElement('span');
    caption.textContent = 'in the community';
    details.append(name, caption);
    const follow = document.createElement('button');
    follow.type = 'button';
    const isFollowing = followingIds.has(profile.id);
    follow.className = `follow-button${isFollowing ? ' is-following' : ''}`;
    follow.textContent = isFollowing ? 'Following' : 'Follow';
    follow.setAttribute('aria-label', `${isFollowing ? 'Unfollow' : 'Follow'} ${profile.displayName || 'member'}`);
    follow.addEventListener('click', () => {
      if (!currentUser) openAuth('signup', { type: 'follow', userId: profile.id });
      else toggleFollow(profile.id);
    });
    row.append(avatar, details, follow);
    list.append(row);
  });
}

async function toggleFollow(userId) {
  if (!currentUser || !db || userId === currentUser.uid) return;
  const ref = db.doc(db.firestore, 'users', currentUser.uid, 'following', userId);
  try {
    if (followingIds.has(userId)) {
      await db.deleteDoc(ref);
    } else {
      await db.setDoc(ref, { followedAt: db.serverTimestamp() });
    }
  } catch (error) {
    console.error('Follow update failed:', error);
    showToast('Could not update that connection. Check your Firebase rules.');
  }
}

function setupPublicListeners() {
  if (!publicUnsubscribe) {
    const feedQuery = db.query(db.collection(db.firestore, 'posts'), db.orderBy('createdAt', 'desc'), db.limit(30));
    publicUnsubscribe = db.onSnapshot(feedQuery, snapshot => {
      renderFeed(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    }, error => {
      console.error('Social feed failed:', error);
      $('#feedStatus').textContent = 'Temporarily unavailable';
      showToast('The community feed could not load. Check the published Firestore rules.');
    });
  }
  if (!directoryUnsubscribe) {
    const directoryQuery = db.query(db.collection(db.firestore, 'users'), db.orderBy('displayName'), db.limit(30));
    directoryUnsubscribe = db.onSnapshot(directoryQuery, snapshot => {
      profiles = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      renderProfiles();
    }, error => {
      console.error('Community directory failed:', error);
      $('#peopleCount').textContent = 'Unavailable';
    });
  }
}

async function handleSignedIn(user) {
  currentUser = user;
  $('#loginTop').classList.add('hidden');
  $('#signupTop').classList.add('hidden');
  $('#accountButton').classList.remove('hidden');
  $('#accountButton').textContent = initials(user.email || 'in');
  $('#accountButton').title = 'Sign out';
  $('#postInput').placeholder = 'Share something kind or honest…';
  $('#postHint').textContent = 'Your post will be public.';
  $('#syncStatus').textContent = 'Connecting your private space…';
  try {
    await ensureProfile(user, preferredProfileName);
  } catch (error) {
    console.error('Profile setup failed:', error);
    showToast('Your account opened, but its public profile could not be saved.');
  }
  stopListeners();
  setupPublicListeners();
  startPrivateListeners(user);
  const followingQuery = db.collection(db.firestore, 'users', user.uid, 'following');
  privateUnsubscribers.push(db.onSnapshot(followingQuery, snapshot => {
    followingIds = new Set(snapshot.docs.map(item => item.id));
    renderProfiles();
  }, error => {
    console.error('Following sync failed:', error);
    showToast('Your connections could not sync. Check the Firebase rules.');
  }));
}

function handleSignedOut() {
  currentUser = null;
  stopListeners();
  followingIds = new Set();
  $('#loginTop').classList.remove('hidden');
  $('#signupTop').classList.remove('hidden');
  $('#accountButton').classList.add('hidden');
  $('#postInput').placeholder = 'What’s on your mind? Sign in to share a thought.';
  $('#postHint').textContent = 'Be kind. Keep it human.';
  $('#syncStatus').textContent = firebaseStatus === 'ready' ? 'Sign in to save your goals and sync across your devices.' : 'Account syncing is not connected yet.';
  $('#myspaceStatus').textContent = 'Private preview';
  $('#goalList').innerHTML = '<article class="goal-row sample-goal"><div class="goal-topline"><span>Make time to read</span><span>3 / 5</span></div><div class="progress-track"><i style="width:60%"></i></div><span class="sample-label">Sample view</span></article><article class="goal-row sample-goal"><div class="goal-topline"><span>Step outside each day</span><span>2 / 4</span></div><div class="progress-track"><i style="width:50%"></i></div><span class="sample-label">Sample view</span></article>';
  $('#savedNotes').replaceChildren();
  renderProfiles();
  renderFeed([]);
}

async function startFirebase() {
  if (!firebaseConfigReady) {
    firebaseStatus = 'missing';
    updateAuthAvailability();
    handleSignedOut();
    return;
  }
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
    ]);
    const firebaseApp = appSdk.initializeApp(firebaseConfig);
    const firestore = firestoreSdk.getFirestore(firebaseApp);
    db = {
      firestore,
      collection: firestoreSdk.collection,
      doc: firestoreSdk.doc,
      addDoc: firestoreSdk.addDoc,
      setDoc: firestoreSdk.setDoc,
      updateDoc: firestoreSdk.updateDoc,
      deleteDoc: firestoreSdk.deleteDoc,
      getDoc: firestoreSdk.getDoc,
      query: firestoreSdk.query,
      orderBy: firestoreSdk.orderBy,
      limit: firestoreSdk.limit,
      onSnapshot: firestoreSdk.onSnapshot,
      serverTimestamp: firestoreSdk.serverTimestamp
    };
    const firebaseAuth = authSdk.getAuth(firebaseApp);
    auth = {
      createUserWithEmailAndPassword: authSdk.createUserWithEmailAndPassword.bind(null, firebaseAuth),
      signInWithEmailAndPassword: authSdk.signInWithEmailAndPassword.bind(null, firebaseAuth),
      sendPasswordResetEmail: authSdk.sendPasswordResetEmail.bind(null, firebaseAuth),
      signOut: authSdk.signOut.bind(null, firebaseAuth)
    };
    firebaseStatus = 'ready';
    updateAuthAvailability();
    setupPublicListeners();
    authSdk.onAuthStateChanged(firebaseAuth, async user => {
      if (user) await handleSignedIn(user);
      else handleSignedOut();
    });
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    firebaseStatus = 'error';
    updateAuthAvailability();
    handleSignedOut();
  }
}

// Breathing exercise: five gentle 12-second cycles.
const breathStage = $('#breathStage');
const breathButton = $('#breathButton');
const breathCue = $('#breathCue');
const breathTimer = $('#breathTimer');
const breathPhases = [
  { name: 'Breathe in', duration: 4, className: 'is-inhale' },
  { name: 'Pause', duration: 2, className: 'is-hold' },
  { name: 'Breathe out', duration: 6, className: 'is-exhale' }
];
let breathTimeout;
let breathClock;
let breathActive = false;
let breathPhaseIndex = 0;
let breathCyclesLeft = 5;
let breathEndTime = 0;

function stopBreathing(finished = false) {
  clearTimeout(breathTimeout);
  clearInterval(breathClock);
  breathActive = false;
  breathStage.classList.remove('is-inhale', 'is-hold', 'is-exhale');
  breathCue.textContent = finished ? 'Well done' : 'Ready';
  breathTimer.textContent = finished ? 'A minute for you' : '1 minute';
  breathButton.innerHTML = 'Begin <span aria-hidden="true">→</span>';
  if (finished) showToast('Your breathing pause is complete.');
}

function runBreathPhase() {
  if (!breathActive) return;
  const phase = breathPhases[breathPhaseIndex];
  breathStage.classList.remove('is-inhale', 'is-hold', 'is-exhale');
  breathStage.classList.add(phase.className);
  breathCue.textContent = phase.name;
  breathTimeout = setTimeout(() => {
    breathPhaseIndex += 1;
    if (breathPhaseIndex >= breathPhases.length) {
      breathPhaseIndex = 0;
      breathCyclesLeft -= 1;
      if (breathCyclesLeft <= 0) { stopBreathing(true); return; }
    }
    runBreathPhase();
  }, phase.duration * 1000);
}

breathButton.addEventListener('click', () => {
  if (breathActive) { stopBreathing(false); return; }
  breathActive = true;
  breathPhaseIndex = 0;
  breathCyclesLeft = 5;
  breathEndTime = Date.now() + 60000;
  breathButton.innerHTML = 'End session <span aria-hidden="true">×</span>';
  breathClock = setInterval(() => {
    const left = Math.max(0, Math.ceil((breathEndTime - Date.now()) / 1000));
    breathTimer.textContent = `0:${String(left).padStart(2, '0')} left`;
  }, 250);
  runBreathPhase();
});

// A short sensory grounding prompt visitors can use without an account.
const groundingSteps = [
  ['5 things you can see', 'Look around and notice five things in front of you.'],
  ['4 things you can feel', 'Notice four sensations: your feet on the floor, fabric, air.'],
  ['3 things you can hear', 'Pause and listen for three sounds, near or far.'],
  ['2 things you can smell', 'Notice two scents, or two things you enjoy smelling.'],
  ['1 thing you can taste', 'Notice one taste, or take a slow sip of water.']
];
let groundingIndex = -1;
$('#groundingButton').addEventListener('click', event => {
  groundingIndex += 1;
  if (groundingIndex >= groundingSteps.length) {
    groundingIndex = -1;
    $('#groundingPrompt').innerHTML = '<span class="grounding-count">Start here</span><p>Notice five things you can see.</p>';
    event.currentTarget.innerHTML = 'Start the exercise <span aria-hidden="true">→</span>';
    showToast('You made a little room to notice.');
    return;
  }
  const [count, prompt] = groundingSteps[groundingIndex];
  const countNode = document.createElement('span');
  countNode.className = 'grounding-count';
  countNode.textContent = count;
  const promptNode = document.createElement('p');
  promptNode.textContent = prompt;
  $('#groundingPrompt').replaceChildren(countNode, promptNode);
  event.currentTarget.innerHTML = groundingIndex === groundingSteps.length - 1
    ? 'Finish gently <span aria-hidden="true">→</span>'
    : 'Next <span aria-hidden="true">→</span>';
});

// An unhurried, untimed game: find and tap the light as it moves.
let gamePlaying = false;
let gameScore = 0;
const gameLight = $('#gameLight');
function moveGameLight() {
  const board = $('#gameBoard');
  const maxLeft = Math.max(8, board.clientWidth - 30);
  const maxTop = Math.max(8, board.clientHeight - 30);
  gameLight.style.left = `${Math.floor(8 + Math.random() * Math.max(1, maxLeft - 16))}px`;
  gameLight.style.top = `${Math.floor(8 + Math.random() * Math.max(1, maxTop - 16))}px`;
}
$('#gameButton').addEventListener('click', event => {
  if (gamePlaying) {
    gamePlaying = false;
    gameLight.classList.add('hidden');
    $('#gameMessage').textContent = `You found ${gameScore} ${gameScore === 1 ? 'light' : 'lights'}.`;
    event.currentTarget.innerHTML = 'Play again <span aria-hidden="true">→</span>';
    return;
  }
  gamePlaying = true;
  gameScore = 0;
  $('#gameScore').textContent = '0 found';
  $('#gameMessage').textContent = 'There it is.';
  gameLight.classList.remove('hidden');
  moveGameLight();
  event.currentTarget.innerHTML = 'Finish <span aria-hidden="true">→</span>';
});
gameLight.addEventListener('click', () => {
  if (!gamePlaying) return;
  gameScore += 1;
  $('#gameScore').textContent = `${gameScore} found`;
  moveGameLight();
});

// Compact mobile navigation; selecting a section closes the menu.
const header = $('.site-header');
const menuToggle = $('#menuToggle');
menuToggle.addEventListener('click', () => {
  const open = header.classList.toggle('nav-open');
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
$$('.main-nav a').forEach(link => link.addEventListener('click', () => {
  header.classList.remove('nav-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
}));

$('#privacyLink').addEventListener('click', () => showToast('MySpace entries are private to your account. Social posts and your display name are public.'));

if (!firebaseConfigReady) firebaseStatus = 'missing';
updateAuthAvailability();
handleSignedOut();
if (firebaseConfigReady) startFirebase();
