import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RuntimeMonitor } from '../dist/runtimeMonitor.js';

const monitor = new RuntimeMonitor(2, 50);
let updates = 0;
const unsubscribe = monitor.subscribe(() => { updates += 1; });

const projectA = { id: 'project-a', name: 'Alpha', root: '/work/alpha' };
const projectB = { id: 'project-b', name: 'Beta', root: '/work/beta' };
const routeA = 'route_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const routeB = 'route_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const pendingRoute = 'route_cccccccccccccccccccccccccccccccc';

const first = monitor.beginSession();
const firstTransport = '11111111-1111-4111-8111-111111111111';
first.bindTransport(firstTransport);
first.selectProject(projectA, routeA);
first.recordTool({ name: 'read', status: 'ok', durationMs: 12, routeId: routeA });
first.recordTool({ name: 'search', status: 'error', durationMs: 30, routeId: routeA });
first.recordTool({ name: 'git_status', status: 'ok', durationMs: 5, routeId: routeA });

// ChatGPT may use a fresh MCP transport for every call. The durable route must
// still produce one GUI chat and aggregate its tool history.
const firstSibling = monitor.beginSession();
const siblingTransport = '22222222-2222-4222-8222-222222222222';
firstSibling.bindTransport(siblingTransport);
firstSibling.selectProject(projectA, routeA);
firstSibling.recordTool({ name: 'tree', status: 'ok', durationMs: 7, routeId: routeA });

const second = monitor.beginSession();
const secondTransport = '33333333-3333-4333-8333-333333333333';
second.bindTransport(secondTransport);
second.selectProject(projectB, routeB);

// Repeated picker/discovery attempts are connections, not chats, until a
// project is selected.
const pending = monitor.beginSession();
pending.bindTransport('44444444-4444-4444-8444-444444444444');
pending.recordTool({ name: 'list_projects', status: 'ok', durationMs: 4, routeId: pendingRoute });

const backgroundProbe = monitor.beginSession();
backgroundProbe.bindTransport('55555555-5555-4555-8555-555555555555');

const live = monitor.snapshot();
assert.equal(live.active_sessions, 2);
assert.equal(live.pending_sessions, 0);
assert.equal(live.open_connections, 5);
assert.equal(live.sessions.length, 2, 'durable routes should merge transports and hide unbound picker attempts');
assert.equal(live.activity.length, 2, 'activity history should be bounded');
assert.equal(live.activity[0].tool, 'list_projects');
assert.equal(live.activity[1].tool, 'tree');
assert.ok(live.sessions.every((session) => /^chat-[0-9a-f]{8}$/.test(session.id)));
assert.equal(live.sessions.find((session) => session.project?.id === 'project-a')?.tool_calls, 4);
assert.equal(live.sessions.find((session) => session.project?.id === 'project-a')?.errors, 1);
const serialized = JSON.stringify(live);
for (const forbidden of [firstTransport, siblingTransport, secondTransport, routeA, routeB, pendingRoute]) {
  assert.doesNotMatch(serialized, new RegExp(forbidden));
}
assert.ok(updates >= 14, 'connection and chat lifecycle should notify live subscribers');

first.close();
const siblingStillLive = monitor.snapshot();
assert.equal(siblingStillLive.sessions.find((session) => session.project?.id === 'project-a')?.state, 'active');

firstSibling.close();
second.close();
pending.close();
backgroundProbe.close();
const closed = monitor.snapshot();
assert.equal(closed.active_sessions, 0);
assert.equal(closed.pending_sessions, 0);
assert.equal(closed.open_connections, 0);
assert.equal(closed.recent_sessions, 2);
assert.ok(closed.sessions.every((session) => session.state === 'closed'));

const expired = monitor.snapshot(Date.now() + 100);
assert.equal(expired.sessions.length, 0, 'closed route chats should expire from process memory');
unsubscribe();

const bounded = new RuntimeMonitor(10, 60_000, 2);
bounded.beginSession().bindTransport('66666666-6666-4666-8666-666666666666');
bounded.beginSession().bindTransport('77777777-7777-4777-8777-777777777777');
bounded.beginSession().bindTransport('88888888-8888-4888-8888-888888888888');
assert.equal(bounded.snapshot().sessions.length, 0, 'connection probes should stay out of chat telemetry');
assert.equal(bounded.snapshot().open_connections, 2, 'connection telemetry should remain count-bounded');

const agentBounded = new RuntimeMonitor(10, 60_000, 32);
const agentBoundedHandle = agentBounded.beginSession();
agentBoundedHandle.bindTransport('89898989-8989-4989-8989-898989898989');
agentBoundedHandle.selectProject(projectA, routeA);
for (let index = 0; index < 16; index += 1) {
  agentBounded.mutateRouteAgent(routeA, routeA, {
    action: 'register',
    childRouteId: `route_${index.toString(16).padStart(32, '0')}`,
    name: `Agent ${index + 1}`,
    role: 'Bounded parallel task'
  });
}
assert.throws(
  () => agentBounded.mutateRouteAgent(routeA, routeA, {
    action: 'register',
    childRouteId: 'route_ffffffffffffffffffffffffffffffff',
    name: 'Agent 17',
    role: 'Exceeds the bounded ledger'
  }),
  /at most 16/
);

const metadataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-chat-lifecycle-'));
const metadataPath = path.join(metadataRoot, 'chat-metadata.json');
const lifecycle = new RuntimeMonitor(10, 50, 10, metadataPath);
const lifecycleHandle = lifecycle.beginSession();
lifecycleHandle.bindTransport('99999999-9999-4999-8999-999999999999');
lifecycleHandle.selectProject(projectA, routeA);
const lifecycleId = lifecycle.snapshot().sessions[0].id;
lifecycle.updateRouteTask(routeA, {
  title: 'Ship task progress',
  status: 'working',
  detail: 'Running focused verification.',
  steps: [
    { title: 'Implement', status: 'completed' },
    { title: 'Verify', status: 'in_progress' }
  ],
  updatedAt: '2026-07-23T00:00:00.000Z'
});
lifecycle.updateSession(lifecycleId, { title: 'Release audit', pinned: true, archived: true });
const childRouteA = 'route_dddddddddddddddddddddddddddddddd';
const childRouteB = 'route_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const registeredA = lifecycle.mutateRouteAgent(routeA, routeA, {
  action: 'register',
  childRouteId: childRouteA,
  name: 'Explorer',
  role: 'Map the implementation surface',
  status: 'working',
  detail: 'Inspecting bounded interfaces.'
});
const registeredB = lifecycle.mutateRouteAgent(routeA, routeA, {
  action: 'register',
  childRouteId: childRouteB,
  name: 'Verifier',
  role: 'Run isolated regression checks'
});
const agentA = registeredA.agent;
const agentB = registeredB.agent;
assert.match(agentA?.id ?? '', /^agt_[a-f0-9]{16}$/);
assert.match(agentB?.id ?? '', /^agt_[a-f0-9]{16}$/);
assert.notEqual(agentA?.id, agentB?.id);
assert.throws(
  () => lifecycle.mutateRouteAgent(routeA, childRouteA, { action: 'update', agentId: agentB.id, status: 'failed' }),
  /only its own/
);
lifecycle.mutateRouteAgent(routeA, childRouteA, {
  action: 'update',
  agentId: agentA.id,
  status: 'done',
  detail: null,
  result: 'Mapped the relevant interfaces.'
});
const childHandle = lifecycle.beginSession();
childHandle.bindTransport('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
childHandle.selectProject(projectA, childRouteA);
childHandle.recordTool({ name: 'search', status: 'ok', durationMs: 3, routeId: childRouteA });
const labeled = lifecycle.snapshot().sessions[0];
assert.equal(labeled.title, 'Release audit');
assert.equal(labeled.pinned, true);
assert.equal(labeled.archived, true);
assert.equal(labeled.task?.title, 'Ship task progress');
assert.equal(labeled.task?.steps[1]?.status, 'in_progress');
assert.equal(labeled.agents.length, 2);
assert.equal(labeled.agents[0].status, 'done');
assert.equal(labeled.agents[0].result, 'Mapped the relevant interfaces.');
assert.equal(lifecycle.snapshot().sessions.length, 1, 'child routes should remain nested under the parent task');
assert.equal(lifecycle.snapshot().activity[0].session_id, lifecycleId, 'child activity should roll up to the parent task');
childHandle.close();
lifecycleHandle.close();
assert.equal(lifecycle.snapshot(Date.now() + 100).sessions.length, 1, 'pinned or archived chats should survive normal closed-session pruning');

const restored = new RuntimeMonitor(10, 50, 10, metadataPath);
const restoredHandle = restored.beginSession();
restoredHandle.bindTransport('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
restoredHandle.selectProject(projectA, routeA);
const restoredSession = restored.snapshot().sessions[0];
assert.equal(restoredSession.title, 'Release audit');
assert.equal(restoredSession.pinned, true);
assert.equal(restoredSession.archived, true);
assert.equal(restoredSession.task?.status, 'working');
assert.equal(restoredSession.task?.detail, 'Running focused verification.');
assert.equal(restoredSession.agents.length, 2, 'subagent ledger should survive broker restart');
assert.equal(restored.mutateRouteAgent(routeA, childRouteA, { action: 'list' }).agents[0].result, 'Mapped the relevant interfaces.');
restored.updateRouteTask(routeA, null);
assert.equal(restored.snapshot().sessions[0].task, null, 'task progress should clear without changing chat lifecycle metadata');
restored.mutateRouteAgent(routeA, routeA, { action: 'clear' });
assert.equal(restored.snapshot().sessions[0].agents.length, 0, 'parent should be able to clear its subagent ledger');
const metadataMode = (await fs.stat(metadataPath)).mode & 0o777;
assert.equal(metadataMode, 0o600, 'chat metadata should be private to the local user');

console.log('✓ runtime monitor smoke test passed');
