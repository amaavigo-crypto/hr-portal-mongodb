import assert from 'node:assert/strict';
import { configuredSiteUrl } from '../api/_lib/appUrl.ts';

const set = (base?: string, url?: string) => {
  if (base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = base;
  if (url === undefined) delete process.env.APP_URL; else process.env.APP_URL = url;
};

set(); assert.equal(configuredSiteUrl(), '', 'nothing set');
set(undefined, 'https://hr.example.com'); assert.equal(configuredSiteUrl(), 'https://hr.example.com', 'APP_URL alone works (it is the name in .env.example)');
set('https://base.example.com'); assert.equal(configuredSiteUrl(), 'https://base.example.com', 'APP_BASE_URL alone works');
set('https://base.example.com', 'https://url.example.com'); assert.equal(configuredSiteUrl(), 'https://base.example.com', 'APP_BASE_URL wins if both are set');
set('  https://hr.example.com/// \n'); assert.equal(configuredSiteUrl(), 'https://hr.example.com', 'spaces and trailing slashes are removed');
set('hr.example.com'); assert.equal(configuredSiteUrl(), 'https://hr.example.com', 'https:// is added when left out');
set('   '); assert.equal(configuredSiteUrl(), '', 'blank is not an address');
set('', 'https://only-url.example.com'); assert.equal(configuredSiteUrl(), 'https://only-url.example.com', 'an empty APP_BASE_URL falls back to APP_URL');
console.log('app.url OK');
