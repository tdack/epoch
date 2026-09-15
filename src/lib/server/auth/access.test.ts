import { describe, it, expect } from 'vitest';
import { validateAccessJwt, extractAccessJwt } from './access';
import { isActionAllowed, hasMinimumRole } from './authorization';

function createMockJwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'none', typ: 'JWT' }): string {
  const b64Url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64Url(header)}.${b64Url(payload)}.mockSignature`;
}

describe('Cloudflare Access JWT & Authorization', () => {
  it('extracts token from cf-access-jwt-assertion header', () => {
    const req = new Request('https://epoch.example.com', {
      headers: { 'cf-access-jwt-assertion': 'sample-jwt-token' }
    });
    expect(extractAccessJwt(req)).toBe('sample-jwt-token');
  });

  it('extracts token from CF_Authorization cookie', () => {
    const req = new Request('https://epoch.example.com', {
      headers: { cookie: 'foo=bar; CF_Authorization=cookie-jwt-token; other=1' }
    });
    expect(extractAccessJwt(req)).toBe('cookie-jwt-token');
  });

  it('extracts token from Authorization: Bearer header', () => {
    const req = new Request('https://epoch.example.com', {
      headers: { authorization: 'Bearer bearer-token' }
    });
    expect(extractAccessJwt(req)).toBe('bearer-token');
  });

  it('rejects expired token', async () => {
    const token = createMockJwt({
      sub: 'user-123',
      email: 'user@example.com',
      iss: 'https://test.cloudflareaccess.com',
      aud: 'test-aud',
      exp: Math.floor(Date.now() / 1000) - 100
    });

    await expect(validateAccessJwt(token, { aud: 'test-aud', allowDevBypass: true })).rejects.toThrow('expired');
  });

  it('rejects audience mismatch', async () => {
    const token = createMockJwt({
      sub: 'user-123',
      email: 'user@example.com',
      iss: 'https://test.cloudflareaccess.com',
      aud: 'wrong-aud',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    await expect(validateAccessJwt(token, { aud: 'expected-aud', allowDevBypass: true })).rejects.toThrow('audience');
  });

  it('validates dev/test bypass token successfully', async () => {
    const token = createMockJwt({
      sub: 'user-456',
      email: 'alex@example.com',
      name: 'Alex Smith',
      iss: 'https://test.cloudflareaccess.com',
      aud: 'my-aud',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const user = await validateAccessJwt(token, { aud: 'my-aud', allowDevBypass: true });
    expect(user.accessSub).toBe('user-456');
    expect(user.email).toBe('alex@example.com');
    expect(user.name).toBe('Alex Smith');
  });

  it('enforces role hierarchy and permissions', () => {
    expect(hasMinimumRole('owner', 'manager')).toBe(true);
    expect(hasMinimumRole('editor', 'contributor')).toBe(true);
    expect(hasMinimumRole('viewer', 'editor')).toBe(false);

    // Tree actions
    expect(isActionAllowed('viewer', 'tree:view')).toBe(true);
    expect(isActionAllowed('viewer', 'record:edit')).toBe(false);
    expect(isActionAllowed('contributor', 'record:create')).toBe(true);
    expect(isActionAllowed('contributor', 'record:edit')).toBe(false);
    expect(isActionAllowed('editor', 'record:edit')).toBe(true);
    expect(isActionAllowed('editor', 'tree:manage_members')).toBe(false);
    expect(isActionAllowed('manager', 'tree:manage_members')).toBe(true);
    expect(isActionAllowed('manager', 'tree:delete')).toBe(false);
    expect(isActionAllowed('owner', 'tree:delete')).toBe(true);
    expect(isActionAllowed(null, 'tree:view')).toBe(false);
  });
});
