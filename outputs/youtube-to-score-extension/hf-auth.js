// Sign in with Hugging Face, so transcriptions run on the user's own ZeroGPU quota.
//
// The OAuth client is a Client ID Metadata Document on the Kiku AI Space. Hugging
// Face only returns to the addresses that document lists, and every unpacked copy
// of this extension has its own ID, so Hugging Face returns to the Space's
// /auth/extension, which forwards to this extension's chromiumapp.org address
// (named at the start of `state`) where chrome.identity picks the answer up.
// PKCE keeps the code useless to anything but this extension.

const APP = 'https://reubencf-kiku-ai.hf.space';
const CLIENT_ID = `${APP}/oauth/youtube-to-score`;
const REDIRECT = `${APP}/auth/extension`;
const SCOPES = 'openid profile';
// Renew a little before Hugging Face's expiry, so a long transcription keeps a valid token.
const MARGIN = 5 * 60 * 1000;

function random(bytes) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/**
 * Runs the Hugging Face sign-in and stores the account. Without `interactive`
 * it succeeds only when Hugging Face can answer without showing anything (the
 * user is signed in there and already allowed the extension).
 */
export async function signIn({interactive = true} = {}) {
  const verifier = random(32);
  const state = `${chrome.runtime.id}.${random(16)}`;
  const url = new URL('https://huggingface.co/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });

  let answer;
  try {
    answer = await chrome.identity.launchWebAuthFlow({url: url.href, interactive});
  } catch (err) {
    if (/did not approve|cancel|closed/i.test(err.message)) throw new Error('Sign-in was cancelled.');
    throw new Error(`Hugging Face sign-in did not finish (${err.message}).`);
  }
  const params = new URL(answer).searchParams;
  if (params.get('error')) throw new Error(params.get('error_description') || `Hugging Face did not sign you in (${params.get('error')}).`);
  if (params.get('state') !== state || !params.get('code')) throw new Error('Sign-in did not complete. Please try again.');

  const res = await fetch('https://huggingface.co/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error('Hugging Face did not accept the sign-in. Please try again.');
  const tokens = await res.json();
  if (typeof tokens.access_token !== 'string') throw new Error('Hugging Face sent an unexpected answer.');

  const who = await fetch('https://huggingface.co/oauth/userinfo', {headers: {Authorization: `Bearer ${tokens.access_token}`}});
  if (!who.ok) throw new Error('Could not read your Hugging Face profile.');
  const info = await who.json();
  const handle = info.preferred_username || info.name || 'you';
  const account = {
    token: tokens.access_token,
    // Hugging Face OAuth tokens last hours; assume one hour if it does not say.
    expires: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    handle,
    name: info.name || handle,
    picture: typeof info.picture === 'string' ? info.picture : '',
  };
  await chrome.storage.local.set({account});
  return account;
}

export async function signOut() {
  await chrome.storage.local.remove('account');
}

/** The signed-in account, or null. An expired one comes back with `expired: true`. */
export async function getAccount() {
  const {account} = await chrome.storage.local.get('account');
  if (!account?.token) return null;
  return {...account, expired: account.expires - MARGIN < Date.now()};
}

/**
 * The token to call Spaces with: the signed-in account's, renewed quietly once it
 * expires, or none (the anonymous quota).
 */
export async function spaceToken() {
  const account = await getAccount();
  if (account && !account.expired) return account.token;
  if (account) {
    try { return (await signIn({interactive: false})).token; } catch {}
  }
  return '';
}
