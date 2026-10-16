const CLIENT_ID_KEY = 'lakou-client-id';
const GUEST_NAME_KEY = 'lakou-guest-name';

export function getClientId() {
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getGuestName() {
  return sessionStorage.getItem(GUEST_NAME_KEY) ?? '';
}

export function saveGuestName(name: string) {
  const clean = name.trim().slice(0, 24);
  if (clean) sessionStorage.setItem(GUEST_NAME_KEY, clean);
  return clean;
}