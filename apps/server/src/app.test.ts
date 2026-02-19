import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('operational endpoints', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  it('serves liveness without requiring a database connection', async () => {
    const app = buildApp();
    apps.push(app);
