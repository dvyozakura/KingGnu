/** アカウントのファイル保存（再起動しても消えない・バックアップ） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountService } from '../src/core/accounts';
import { FileAccountStore } from '../src/core/store';

test('ファイル保存：再起動後も残る・毎日のバックアップ', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kh-'));
  const svc = new AccountService(new FileAccountStore(dir, () => undefined), null, null, { allowTestPurchases: true });
  const { rec, session } = svc.createGuest();
  svc.dailyBonus(rec);
  svc.testPurchase(rec, 'kinghorn.emerald100');
  svc.buyMaterial(rec, 'iron');
  svc.store.flush();
  assert.ok(existsSync(join(dir, 'accounts.json')));
  assert.equal(readdirSync(join(dir, 'backup')).length, 1);
  // 「再起動」
  const svc2 = new AccountService(new FileAccountStore(dir, () => undefined));
  const again = svc2.bySession(session);
  assert.equal(again.id, rec.id);
  assert.equal(again.emeralds, 90);
  assert.deepEqual(again.materials, ['iron']);
  assert.equal(svc2.dailyBonus(again), 0, '同じ日はログボなし（再起動しても）');
});
