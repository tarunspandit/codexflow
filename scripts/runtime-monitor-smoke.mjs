import assert from 'node:assert/strict';
import { RuntimeMonitor } from '../dist/runtimeMonitor.js';

const monitor = new RuntimeMonitor(2, 50);
let updates = 0;
const unsubscribe = monitor.subscribe(() => { updates += 1; });

const first = monitor.beginSession();
const firstTransport = '11111111-1111-4111-8111-111111111111';
first.bindTransport(firstTransport);
first.selectProject({ id: 'project-a', name: 'Alpha', root: '/work/alpha' });
first.recordTool({ name: 'read', status: 'ok', durationMs: 12 });
first.recordTool({ name: 'search', status: 'error', durationMs: 30 });
first.recordTool({ name: 'git_status', status: 'ok', durationMs: 5 });

const second = monitor.beginSession();
const secondTransport = '22222222-2222-4222-8222-222222222222';
second.bindTransport(secondTransport);
second.selectProject({ id: 'project-b', name: 'Beta', root: '/work/beta' });

const live = monitor.snapshot();
assert.equal(live.active_sessions, 2);
assert.equal(live.sessions.length, 2);
assert.equal(live.activity.length, 2, 'activity history should be bounded');
assert.equal(live.activity[0].tool, 'git_status');
assert.equal(live.activity[1].tool, 'search');
assert.ok(live.sessions.every((session) => /^chat-[0-9a-f]{8}$/.test(session.id)));
assert.equal(live.sessions.find((session) => session.project?.id === 'project-a')?.tool_calls, 3);
assert.equal(live.sessions.find((session) => session.project?.id === 'project-a')?.errors, 1);
const serialized = JSON.stringify(live);
assert.doesNotMatch(serialized, new RegExp(firstTransport));
assert.doesNotMatch(serialized, new RegExp(secondTransport));
assert.ok(updates >= 9, 'session lifecycle should notify live subscribers');

first.close();
second.close();
const closed = monitor.snapshot();
assert.equal(closed.active_sessions, 0);
assert.equal(closed.recent_sessions, 2);
assert.ok(closed.sessions.every((session) => session.state === 'closed'));

const expired = monitor.snapshot(Date.now() + 100);
assert.equal(expired.sessions.length, 0, 'closed sessions should expire from process memory');
unsubscribe();

const bounded = new RuntimeMonitor(10, 60_000, 2);
bounded.beginSession().bindTransport('33333333-3333-4333-8333-333333333333');
bounded.beginSession().bindTransport('44444444-4444-4444-8444-444444444444');
bounded.beginSession().bindTransport('55555555-5555-4555-8555-555555555555');
assert.equal(bounded.snapshot().sessions.length, 2, 'session telemetry should remain count-bounded');

console.log('✓ runtime monitor smoke test passed');
