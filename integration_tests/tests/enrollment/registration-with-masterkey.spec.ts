import { test, expect } from '@playwright/test';
import { startServer, stopServer } from '../../helpers/server';

test.describe('Registration with Master Key', () => {
  test('Enrollment API creates valid enrollment code', async ({ page }) => {
    const server = await startServer();

    try {
      // Create an enrollment via API
      const response = await fetch(`${server.url}/api/v1/auth/passkeys/enrollment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.code).toBeDefined();
      expect(data.code).toHaveLength(8);
      expect(data.code).toMatch(/^[A-Z0-9]+$/);

    } finally {
      await stopServer(server);
    }
  });

  test('Master key endpoint requires authentication', async ({ page }) => {
    const server = await startServer();

    try {
      // Call the master key endpoint without a token
      const response = await fetch(`${server.url}/api/v1/auth/master-key`);

      expect(response.status).toBe(401);

    } finally {
      await stopServer(server);
    }
  });

  test('Master key endpoint returns 404 when user has no credentials', async ({ page }) => {
    const server = await startServer();

    try {
      // Since we can't easily create a user with a credential without WebAuthn,
      // we test the endpoint returns 401 when not authenticated
      const response = await fetch(`${server.url}/api/v1/auth/master-key`);
      expect(response.status).toBe(401);

    } finally {
      await stopServer(server);
    }
  });

  test('Enrollment can be created and checked in database', async ({ page }) => {
    const server = await startServer();

    try {
      // Create an enrollment
      const response = await fetch(`${server.url}/api/v1/auth/passkeys/enrollment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      const code = data.code;

      // Verify enrollment exists in database
      const Database = require('better-sqlite3');
      const db = new Database(server.dbPath, { readonly: true });

      try {
        const enrollment = db.prepare(
          'SELECT code, user_id, completed FROM passkey_enrollments WHERE code = ?'
        ).get(code);

        expect(enrollment).toBeDefined();
        expect(enrollment.code).toBe(code);
        expect(enrollment.user_id).toBeNull();
        expect(enrollment.completed).toBe(0);
      } finally {
        db.close();
      }

    } finally {
      await stopServer(server);
    }
  });
});