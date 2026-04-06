import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import { startServer, stopServer, ServerInstance } from '../helpers/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TestServerData {
  server: ServerInstance;
  serverUrl: string;
  page: Page;
  context: BrowserContext;
}

export interface AuthenticatedPageData {
  page: Page;
  context: BrowserContext;
  serverUrl: string;
  email: string;
  cdp: any;
}

export interface CliConfigData {
  configPath: string;
  sessionDir: string;
  serverUrl: string;
  jwtToken?: string;
}

export const testServer = base.extend<TestServerData>({
  server: async ({ browser }, use) => {
    const server = await startServer({
      allowUserCreation: true,
      port: 0,
    });
    await use(server);
    await stopServer(server);
  },
  
  context: async ({ browser, server }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },
  
  page: async ({ context, server }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
  
  serverUrl: async ({ server }, use) => {
    await use(server.url);
  },
});

export const authenticatedPage = base.extend<AuthenticatedPageData>({
  server: async ({ browser }, use) => {
    const server = await startServer({
      allowUserCreation: true,
      port: 0,
    });
    await use(server);
    await stopServer(server);
  },
  
  context: async ({ browser, server }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },
  
  page: async ({ context, server }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
  
  serverUrl: async ({ server }, use) => {
    await use(server.url);
  },
  
  email: async ({}, use) => {
    await use(`test-${Date.now()}@example.com`);
  },
});

export const cliConfig = base.extend<CliConfigData>({
  server: async ({}, use) => {
    const server = await startServer({
      allowUserCreation: true,
      port: 0,
    });
    await use(server);
    await stopServer(server);
  },
  
  configPath: async ({ server }, use) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-config-'));
    const configPath = path.join(tempDir, 'config.yml');
    
    const configContent = `server_url: ${server.url}\n`;
    fs.writeFileSync(configPath, configContent);
    
    await use(configPath);
    
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
    }
  },
  
  sessionDir: async ({}, use) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsesh-sessions-'));
    await use(tempDir);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
    }
  },
  
  serverUrl: async ({ server }, use) => {
    await use(server.url);
  },
});

export { expect } from '@playwright/test';