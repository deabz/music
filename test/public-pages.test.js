const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { healthPage } = require("../src/health-page");
const { statusPage, notFoundPage } = require("../src/status-page");
const { commands } = require("../src/commands");
const { websiteCommandGroups } = require("../src/commands");
const { playbackPosition } = require("../src/playback-position");

test("public pages share navigation, no-flash theme setup, metadata and private-free playback markup", () => {
  const site = require("../src/website");
  for (const page of [healthPage, statusPage, notFoundPage, site.commandsPage, site.changelogPage]) {
    for (const [, script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(script));
    assert.match(page, /name="viewport"/);
    assert.match(page, /name="robots" content="noindex/);
    assert.match(page, /class="site-nav"/);
    assert.match(page, /class="site-footer"/);
    assert.ok(page.indexOf("localStorage.getItem('nyx-theme')") < page.indexOf('rel="stylesheet"'));
    assert.ok(!page.includes('track-server'));
    assert.ok(!page.includes('Playing in'));
    assert.ok(!page.includes('current-requester'));
  }
  assert.doesNotThrow(() => new vm.Script(site.js));
  assert.equal(site.publicCommands.length, commands.length);
  for (const command of site.publicCommands) {
    assert.ok(command.usage.startsWith('/'+command.name));
    assert.ok(command.example.startsWith('/'+command.name));
    assert.ok(!('default_member_permissions' in command));
  }
});

test("website categories cover the real registry exactly once", () => {
  assert.deepEqual(websiteCommandGroups.map(group=>group.label),["Playback","Queue","Audio effects","Info and utility","Settings"]);
  const names=websiteCommandGroups.flatMap(group=>group.commands.map(command=>command.name));
  assert.deepEqual([...names].sort(),commands.map(command=>command.name).sort());
  assert.equal(new Set(names).size,commands.length);
});

test("live position includes seek offsets, clamps to duration and stops advancing when audio stops", () => {
  const state = { current: { duration: 180 }, resumeOffsetSeconds: 10, resource: { playbackDuration: 5000 } };
  assert.equal(playbackPosition(state), 15);
  assert.equal(playbackPosition(state), 15);
  state.resource.playbackDuration = 6000;
  assert.equal(playbackPosition(state), 16);
  state.resourcePlaybackRate = 1.323;
  assert.equal(playbackPosition(state), 17.938);
  state.resumeOffsetSeconds = 179;
  assert.equal(playbackPosition(state), 180);
  state.current = null;
  assert.equal(playbackPosition(state), 0);
});
