import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-route-store-'));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-route-root-'));
process.env.CODEXFLOW_HOME = home;

const { ChatRouteStore, chatRouteFilePath, isChatRouteId } = await import('../dist/chatRoutes.js');

try {
  const first = new ChatRouteStore(root);
  const routeId = first.createRouteId();
  assert.equal(isChatRouteId(routeId), true);
  first.bind(routeId, { id: 'ws_route_smoke', root });

  const filePath = chatRouteFilePath(root);
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(payload.version, 2);
  assert.equal(payload.routes.length, 1);
  assert.equal(payload.routes[0].routeId, routeId);
  assert.equal(payload.routes[0].workspaceId, 'ws_route_smoke');
  assert.equal(payload.routes[0].location, 'local');

  const remoteRouteId = first.createRouteId();
  first.bindRemote(remoteRouteId, {
    id: 'rws_0123456789abcdef01234567',
    root: '/srv/example',
    hostAlias: 'devbox',
    hostFingerprint: 'a'.repeat(64)
  });
  assert.equal(first.get(remoteRouteId)?.location, 'remote');
  assert.equal(first.get(remoteRouteId)?.remoteHostAlias, 'devbox');

  const restored = new ChatRouteStore(root);
  assert.deepEqual(restored.get(routeId), first.get(routeId));
  assert.throws(
    () => restored.bind('route_not-valid', { id: 'ws_other', root }),
    /Invalid CodexFlow route_id/
  );

  const leftovers = (await fs.readdir(path.dirname(filePath))).filter((name) => name.includes('.tmp'));
  assert.deepEqual(leftovers, []);
  console.log('chat route persistence smoke passed');
} finally {
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
}
