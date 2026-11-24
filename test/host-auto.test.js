const test = require('node:test');
const assert = require('node:assert');
const { spotlightScript } = require('../host-auto');

test('the page script is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(spotlightScript('filekeeper', 'Press "the link" once')));
  assert.doesNotThrow(() => new Function(spotlightScript('filekeeper', '')));
});

test('the hint text cannot break out of the script', () => {
  const evil = '"; window.pwned = 1; //';
  const src = spotlightScript('filekeeper', evil);
  assert.ok(src.includes(JSON.stringify(evil)));
  assert.doesNotThrow(() => new Function(src));
});

test('the script only ever looks for the click-here line, never the main Download button', () => {
  const src = spotlightScript('filekeeper', '');
  assert.ok(!/download-button/.test(src.replace(/Free download[^\n]*/g, '')));
});
