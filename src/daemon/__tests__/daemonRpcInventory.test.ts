// Inventory of the RPC methods src/daemon/index.ts registers on the daemon pipe.
//
// registerRpcHandlers is several thousand lines long and the split card (D-4)
// will move its handlers into modules. A handler dropped or renamed on the way
// would only show up as "Unknown method" at a client, and src/shared/rpc.ts's
// ALL_RPC_METHODS (the API reference's drift guard) lists the main pipe's
// surface, not this one. This pins the daemon pipe surface instead.
//
// Source-shape, like agentProcessExitWiring.test.ts: registerRpcHandlers and
// startDaemon cannot be constructed in a unit test, and probing every method on
// a live daemon would run handlers with side effects (shutdown, createSession).
//
// Adding or removing a method on purpose: update
// fixtures/daemon-index-rpc-methods.txt in the same commit (one name per line,
// sorted).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf-8');
const expected = fs
  .readFileSync(path.join(__dirname, 'fixtures', 'daemon-index-rpc-methods.txt'), 'utf-8')
  .split(/\r?\n/)
  .filter((line) => line.length > 0);

/** `pipeServer.onRpc('<name>', …)` — every registration with a literal name. */
function literalMethods(): string[] {
  return [...src.matchAll(/pipeServer\.onRpc\('([^']+)'/g)].map((m) => m[1]);
}

/** The two loops that register a family under a computed name. */
function loopMethods(): string[] {
  const chat = /for \(const action of \[([^\]]+)\] as const\) \{\s*pipeServer\.onRpc\(`daemon\.chat\.\$\{action\}`/.exec(src);
  const channel = /for \(const \[method, run\] of \[(.*?)\] as const\) \{\s*pipeServer\.onRpc\(method,/s.exec(src);
  if (!chat || !channel) throw new Error('a looped registration changed shape; update this test');
  return [
    ...[...chat[1].matchAll(/'([a-z]+)'/g)].map((m) => `daemon.chat.${m[1]}`),
    ...[...channel[1].matchAll(/\[\s*'([a-z0-9.]+)',/g)].map((m) => m[1]),
  ];
}

describe('daemon pipe RPC inventory (src/daemon/index.ts)', () => {
  it('registers exactly the recorded methods', () => {
    const actual = [...new Set([...literalMethods(), ...loopMethods()])].sort();
    expect(actual).toEqual([...expected].sort());
  });

  it('registers no literal method twice (a second onRpc silently replaces the first handler)', () => {
    const seen = new Set<string>();
    const twice = literalMethods().filter((m) => (seen.has(m) ? true : (seen.add(m), false)));
    expect(twice).toEqual([]);
  });

  it('still hands the pipe to the modules that register their own families', () => {
    expect(src).toMatch(/registerChatV2Rpc\(\(method, handler\) => pipeServer\.onRpc\(method, handler\)/);
    expect(src).toMatch(/registerAutomationRpc\(\(method, handler\) => pipeServer\.onRpc\(method, handler\)/);
    expect(src).toMatch(/const onA2aRpc = [\s\S]{0,200}?pipeServer\.onRpc\(method, handler\);/);
    expect(src).toMatch(/registerA2aRemoteRpc\(onA2aRpc,/);
    expect(src).toMatch(/registerA2aLinkRpc\([\s\S]{0,200}?onA2aRpc\(method, handler\)/);
    expect(src).toMatch(/a2aDelivery\.registerRpc\(onA2aRpc\)/);
  });
});
