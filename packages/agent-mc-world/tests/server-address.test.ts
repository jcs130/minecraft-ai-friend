import { describe, expect, it } from 'vitest';
import { parseMinecraftServerAddress } from '../src/client/config.ts';

describe('shared server address input', () => {
  it.each([
    ['example.test', 'example.test', 25565],
    [' localhost:25577 ', 'localhost', 25577],
    ['192.0.2.10:25566', '192.0.2.10', 25566],
    ['[2001:db8::1]:25567', '2001:db8::1', 25567],
    ['[::1]', '::1', 25565], ['2001:db8::1', '2001:db8::1', 25565],
  ])('parses %s without network access', (address, host, port) => {
    expect(parseMinecraftServerAddress(address)).toEqual({ host, port });
  });
  it('retains a supplied default port', () => {
    expect(parseMinecraftServerAddress('example.test', 25570)).toEqual({ host: 'example.test', port: 25570 });
  });
  it.each(['', 'http://example.test', 'user:secret@example.test', 'example.test/path', 'example.test:0',
    'example.test:65536', 'example.test:abc', '[example.test]:25565', 'example.test?', 'a\nb', 'a\\b', 'example.test:'])
    ('rejects malformed or credential-bearing input %j', address => expect(() => parseMinecraftServerAddress(address)).toThrow());
  it.each([0, 65536, 1.5])('rejects invalid default port %s', port => {
    expect(() => parseMinecraftServerAddress('example.test', port)).toThrow();
  });
});
