import test from 'node:test';
import assert from 'node:assert/strict';
import { restaurantPhoneContact, restaurantTelegramContact } from '../../apps/frontend/src/lib/restaurant-contacts.js';

test('restaurant contact links retain readable numbers and normalize Telegram handles and official profile URLs', () => {
  assert.deepEqual(restaurantPhoneContact('  +998 (90) 123-45-67  '), { label: '+998 (90) 123-45-67', href: 'tel:+998901234567' });
  for (const value of ['@restaurant_help', 'restaurant_help', 'https://t.me/restaurant_help', 't.me/restaurant_help/', 'https://telegram.me/restaurant_help']) {
    assert.deepEqual(restaurantTelegramContact(value), { label: '@restaurant_help', href: 'https://t.me/restaurant_help' });
  }
});

test('missing and unsafe restaurant contacts never become arbitrary navigation links', () => {
  for (const value of [null, undefined, '', 'javascript:alert(1)', '+99890;12345', '+998+901234567', '123', '1234567890123456']) {
    assert.equal(restaurantPhoneContact(value), null);
  }
  for (const value of [null, undefined, '', 'javascript:alert(1)', 'http://t.me/restaurant_help', 'https://t.me.evil.test/restaurant_help', 'https://evil.test/t.me', 'https://user:password@t.me/restaurant_help', 'https://t.me/restaurant_help?redirect=evil', 'https://t.me/restaurant_help#fragment', 'https://t.me/share/url', 'https://t.me/+invite']) {
    assert.equal(restaurantTelegramContact(value), null);
  }
});
