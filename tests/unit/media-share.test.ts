import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsNextVideoPreload, playbackFailure, selectVisibleReel } from '../../apps/frontend/src/lib/media.js';
import { copyShareLink, shareLink, type SharePlatform } from '../../apps/frontend/src/lib/share.js';

const payload = { title: 'UzBite', text: 'Test dish', url: 'http://192.168.1.10:8080/feed?post=test' };

test('only the most visible reel owns playback; ties use proximity to viewport center', () => {
  assert.equal(selectVisibleReel([{ id: 'first', ratio: 0.45, distance: 100 }, { id: 'second', ratio: 0.8, distance: 130 }]), 'second');
  assert.equal(selectVisibleReel([{ id: 'first', ratio: 1, distance: 200 }, { id: 'second', ratio: 1, distance: 30 }]), 'second');
  assert.equal(selectVisibleReel([{ id: 'offscreen', ratio: 0, distance: 0 }, { id: 'edge', ratio: 0.1, distance: 0 }, { id: 'invalid', ratio: NaN, distance: 0 }]), null);
  assert.equal(selectVisibleReel([]), null);
});

test('data saver and slow networks suppress next-video bulk preload', () => {
  assert.equal(allowsNextVideoPreload(), true);
  assert.equal(allowsNextVideoPreload({ effectiveType: '4g' }), true);
  for (const effectiveType of ['slow-2g', '2g', '3g']) assert.equal(allowsNextVideoPreload({ effectiveType }), false);
  assert.equal(allowsNextVideoPreload({ effectiveType: '4g', saveData: true }), false);
});

test('autoplay blocking and interrupted play requests are not treated as corrupt media', () => {
  assert.equal(playbackFailure(new DOMException('Gesture required', 'NotAllowedError')), 'permission');
  assert.equal(playbackFailure({ name: 'AbortError' }), 'interrupted');
  assert.equal(playbackFailure(new DOMException('Unsupported source', 'NotSupportedError')), 'unsupported');
  assert.equal(playbackFailure(new Error('Unexpected failure')), 'unknown');
});

test('successful native sharing does not also copy the link', async () => {
  const actions: string[] = [];
  const platform: SharePlatform = { share: async data => { assert.equal(data.url, payload.url); actions.push('share'); }, writeText: async () => { actions.push('copy'); } };
  assert.equal(await shareLink(payload, platform), 'shared');
  assert.deepEqual(actions, ['share']);
});

test('cancelling the native chooser leaves the clipboard unchanged', async () => {
  let copied = false;
  const platform: SharePlatform = { share: async () => { throw { name: 'AbortError' }; }, writeText: async () => { copied = true; } };
  assert.equal(await shareLink(payload, platform), 'cancelled');
  assert.equal(copied, false);
});

test('blocked or unsupported native sharing falls back to the clipboard', async () => {
  let copies = 0;
  const platform: SharePlatform = { share: async () => { throw new DOMException('Blocked', 'NotAllowedError'); }, writeText: async url => { assert.equal(url, payload.url); copies++; } };
  assert.equal(await shareLink(payload, platform), 'copied');
  assert.equal(await shareLink(payload, { ...platform, canShare: () => false }), 'copied');
  assert.equal(copies, 2);
});

test('HTTP LAN without Clipboard API uses selection copying', async () => {
  const actions: string[] = [];
  const platform: SharePlatform = { copySelection: text => { actions.push(text); return true; } };
  assert.equal(await shareLink(payload, platform), 'copied');
  assert.deepEqual(actions, [payload.url]);
});

test('clipboard permission denial can use selection fallback; total failure returns a manual link', async () => {
  assert.equal(await copyShareLink(payload.url, { writeText: async () => { throw new Error('Denied'); }, copySelection: () => true }), true);
  assert.equal(await shareLink(payload, { writeText: async () => { throw new Error('Denied'); }, copySelection: () => false }), 'manual');
  assert.equal(await shareLink(payload, {}), 'manual');
});
