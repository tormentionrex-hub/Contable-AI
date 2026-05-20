import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDb, seedAdminIfMissing } from '../src/lib/db-init.js';
import { getDb } from '../src/lib/db.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  createUser,
  loginUser,
  findUserByEmail,
  CredencialesInvalidasError,
  TokenInvalidoError,
} from '../src/lib/auth.js';
import { config } from '../src/config.js';

// Forzamos JWT_SECRET para los tests (el .env del dev puede no tenerlo).
const TEST_SECRET = 'test-secret-fase3-vitest-32chars-abcd';

beforeAll(() => {
  // Inyectamos un secret en runtime (config es as const, hackeamos via Object.defineProperty).
  (config.auth as { jwtSecret: string | undefined }).jwtSecret = TEST_SECRET;
  (config.auth as { enabled: boolean }).enabled = true;
  initDb();
});

afterAll(() => {
  // Limpiar users creados en estos tests.
  const db = getDb();
  db.prepare(`DELETE FROM users WHERE email LIKE 'test-%@vitest.local'`).run();
});

beforeEach(() => {
  // Limpieza idempotente antes de cada test.
  const db = getDb();
  db.prepare(`DELETE FROM users WHERE email LIKE 'test-%@vitest.local'`).run();
});

describe('hashPassword / verifyPassword', () => {
  it('genera un hash distinto al plain y verifica OK', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toBe('hunter2');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
    expect(await verifyPassword('hunter2', hash)).toBe(true);
  });

  it('rechaza password incorrecto', async () => {
    const hash = await hashPassword('correcto');
    expect(await verifyPassword('incorrecto', hash)).toBe(false);
  });

  it('rechaza hash inválido sin tirar', async () => {
    // bcrypt.compare con un hash mal formado devuelve false.
    expect(await verifyPassword('algo', 'no-es-un-hash-bcrypt')).toBe(false);
  });
});

describe('signToken / verifyToken', () => {
  it('redondea ida y vuelta preservando los claims', () => {
    const user = { id: 42, email: 'a@b.com', nombre: 'Tester', rol: 'admin' as const, empresa_id: null };
    const token = signToken(user);
    const payload = verifyToken(token);
    expect(payload.sub).toBe(42);
    expect(payload.email).toBe('a@b.com');
    expect(payload.rol).toBe('admin');
    expect(payload.empresa_id).toBe(null);
  });

  it('tira TokenInvalidoError con un token corrupto', () => {
    expect(() => verifyToken('no-es-un-jwt-valido')).toThrow(TokenInvalidoError);
  });

  it('tira TokenInvalidoError con un token firmado con otra clave', () => {
    const otherToken = signToken({ id: 1, email: 'x@y.com', nombre: 'X', rol: 'admin', empresa_id: null });
    // Cambiamos el secret y verificamos que el token previo deja de ser válido.
    (config.auth as { jwtSecret: string }).jwtSecret = 'otra-clave-diferente-32chars-abcd';
    expect(() => verifyToken(otherToken)).toThrow(TokenInvalidoError);
    // Restauramos.
    (config.auth as { jwtSecret: string }).jwtSecret = TEST_SECRET;
  });
});

describe('createUser + loginUser', () => {
  it('crea un user, lo encuentra por email y permite login OK', async () => {
    const user = await createUser({
      email: 'test-login@vitest.local',
      password: 'password-super-secreto',
      nombre: 'Tester Login',
      rol: 'contador',
      empresa_id: '3006696489',
    });
    expect(user.id).toBeGreaterThan(0);
    expect(user.email).toBe('test-login@vitest.local');

    const row = findUserByEmail('test-login@vitest.local');
    expect(row).not.toBeNull();
    expect(row!.nombre).toBe('Tester Login');
    expect(row!.rol).toBe('contador');

    const result = await loginUser('test-login@vitest.local', 'password-super-secreto');
    expect(result.user.id).toBe(user.id);
    expect(result.token.length).toBeGreaterThan(20);
  });

  it('rechaza login con email inexistente', async () => {
    await expect(loginUser('no-existe@vitest.local', 'whatever')).rejects.toBeInstanceOf(
      CredencialesInvalidasError,
    );
  });

  it('rechaza login con password incorrecto', async () => {
    await createUser({
      email: 'test-wrongpw@vitest.local',
      password: 'la-correcta',
      nombre: 'X',
      rol: 'admin',
    });
    await expect(loginUser('test-wrongpw@vitest.local', 'la-incorrecta')).rejects.toBeInstanceOf(
      CredencialesInvalidasError,
    );
  });

  it('normaliza el email a lowercase', async () => {
    await createUser({
      email: 'Test-CASE@VITEST.local',
      password: 'pw-larga-segura',
      nombre: 'X',
      rol: 'admin',
    });
    // Buscar con casing distinto debe encontrarlo.
    const row = findUserByEmail('test-case@vitest.local');
    expect(row).not.toBeNull();
  });
});

describe('seedAdminIfMissing', () => {
  it('crea admin si users está vacía y respeta la existencia', async () => {
    const db = getDb();
    db.exec('DELETE FROM users');
    // Forzamos email+password de test para no depender del .env.
    (config.auth as { adminEmail: string }).adminEmail = 'test-seed-admin@vitest.local';
    (config.auth as { adminPassword: string }).adminPassword = 'seed-password-12';

    await seedAdminIfMissing();
    const count1 = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
    expect(count1).toBe(1);

    // Llamar otra vez NO debe duplicar.
    await seedAdminIfMissing();
    const count2 = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
    expect(count2).toBe(1);

    // Limpiar.
    db.prepare(`DELETE FROM users WHERE email = ?`).run('test-seed-admin@vitest.local');
    (config.auth as { adminEmail: string | undefined }).adminEmail = undefined;
    (config.auth as { adminPassword: string | undefined }).adminPassword = undefined;
  });
});
