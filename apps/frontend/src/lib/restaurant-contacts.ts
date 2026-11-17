export function restaurantPhoneContact(value?: string | null) {
  const label = value?.trim();
  if (!label || !/^\+?[0-9 ()-]{6,30}$/.test(label)) return null;
  const number = label.replace(/[ ()-]/g, '');
  if (!/^\+?[0-9]{6,15}$/.test(number)) return null;
  return { label, href: 'tel:' + number };
}

export function restaurantTelegramContact(value?: string | null) {
  const text = value?.trim();
  if (!text) return null;
  let username = text.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(username)) {
    try {
      const url = new URL(/^https:\/\//i.test(text) ? text : 'https://' + text);
      if (url.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !/^\/[a-zA-Z0-9_]{1,64}\/?$/.test(url.pathname)) return null;
      username = url.pathname.replaceAll('/', '');
    } catch { return null; }
  }
  return { label: '@' + username, href: 'https://t.me/' + username };
}
