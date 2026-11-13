import { describe, expect, it } from 'vitest';
// The main process uses CommonJS to run directly in Electron.
import bus from '../electron/bus.cjs';
describe('bus message parsing', () => {
  it('accepts a complete bus message', () => expect(bus.parseMessage('{"id":"42","from":"boss","to":"scout","text":"hello"}')).toMatchObject({id:'42',to:'scout'}));
  it('ignores malformed or incomplete files', () => { expect(bus.parseMessage('{')).toBeNull(); expect(bus.parseMessage('{"to":"scout"}')).toBeNull(); });
});
