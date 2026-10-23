/**
 * 物理・当たり判定・材質・ダメージの単体テスト（完成条件の自動確認）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CpuBrain,
  HORN_TEMPLATES,
  HornBody,
  MATERIALS,
  MATERIAL_IDS,
  Match,
  SIM_DT,
  buildHornModel,
  computeBodyHit,
  computeMaxHP,
  convexDecompose,
  damageHooks,
  isSimple,
  pointInPolygon,
  processOutline,
  restVertex,
  signedArea,
  templateStrokes,
  validateHornData,
  planSwing,
  Pt,
} from '../src/index';

const poly = (id: string) => {
  const r = processOutline(templateStrokes(id));
  assert.ok(r.ok, `${id}: ${r.error}`);
  return r.polygon;
};

test('手描き輪郭：自己交差を解消し、単純多角形・根元付き・頂点数上限', () => {
  // 8の字（自己交差）
  const fig8: Pt[] = [[0, 0]];
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    fig8.push([60 * Math.sin(a) + 50, -60 * Math.sin(a) * Math.cos(a) - 40]);
  }
  const r = processOutline([fig8]);
  assert.ok(r.ok);
  assert.ok(isSimple(r.polygon));
  assert.ok(r.polygon.length <= 64);
  assert.ok(pointInPolygon(0, 0, r.polygon) || r.warnings.some((w) => w.includes('根元')));
});

test('頭から離れた輪郭は描き直しに誘導（エラー）', () => {
  const r = processOutline([[[100, -100], [150, -100], [150, -150], [100, -150]]]);
  assert.equal(r.ok, false);
  assert.match(r.error!, /根元/);
});

test('巨大な輪郭は最大サイズに縮小、細すぎる線は補強', () => {
  const big = processOutline([[[0, 10], [390, -10], [390, -390], [-10, -390]]]);
  assert.ok(big.ok);
  for (const [x, y] of big.polygon) assert.ok(Math.hypot(x, y) <= 250);
  const thin = processOutline([[[0, -3], [200, -3], [200, -2], [0, -2]]]);
  assert.ok(thin.ok);
  assert.ok(buildHornModel(thin.polygon).stats.maxWidth >= 9);
});

test('凸分解：各ピースが凸で、元の多角形を覆う', () => {
  for (const t of HORN_TEMPLATES) {
    const p = poly(t.id);
    const pieces = convexDecompose(p);
    let area = 0;
    for (const piece of pieces) {
      const pp = piece.map((i) => p[i]);
      area += Math.abs(signedArea(pp));
      for (let i = 0; i < pp.length; i++) {
        const a = pp[i];
        const b = pp[(i + 1) % pp.length];
        const c = pp[(i + 2) % pp.length];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        assert.ok(cr * Math.sign(signedArea(p)) >= -1e-6, `${t.id} piece not convex`);
      }
    }
    assert.ok(Math.abs(area - Math.abs(signedArea(p))) < 1, `${t.id} area mismatch`);
  }
});

test('バインディング：静止時に輪郭頂点を正確に復元（輪郭＝当たり判定）', () => {
  const m = buildHornModel(poly('hook'));
  m.bindings.forEach((b, i) => {
    const [x, y] = restVertex(m, b);
    assert.ok(Math.hypot(x - m.polygon[i][0], y - m.polygon[i][1]) < 1e-6);
  });
});

function swingDeflection(material: (typeof MATERIAL_IDS)[number], tpl = 'classic') {
  const m = new Match({ polygon: poly(tpl), material }, { polygon: poly('stub'), material: 'plastic' }, { countdown: 0 });
  m.fighters[0].x = 200;
  m.fighters[1].x = 1090;
  const f = m.fighters[0];
  for (let i = 0; i < 120; i++) m.step();
  m.setInput(0, { charge: true, move: 0 });
  for (let i = 0; i < 110; i++) m.step();
  m.setInput(0, { charge: false, move: 0 });
  let max = 0;
  for (let i = 0; i < 120; i++) {
    m.step();
    max = Math.max(max, f.horn.tipDeflection());
  }
  return max;
}

test('ゴムの角は大きくしなり、ガラス・あずきのアイスはほとんどしならない', () => {
  const rubber = swingDeflection('rubber');
  const plastic = swingDeflection('plastic');
  const glass = swingDeflection('glass');
  const azuki = swingDeflection('azuki');
  assert.ok(rubber > 80, `rubber ${rubber}`);
  assert.ok(rubber > plastic * 2, `rubber ${rubber} plastic ${plastic}`);
  assert.ok(glass < 20, `glass ${glass}`);
  assert.ok(azuki < 20, `azuki ${azuki}`);
});

test('静止状態で角の物理は安定（エネルギーが湧かない）', () => {
  const model = buildHornModel(poly('whip'));
  for (const mat of MATERIAL_IDS) {
    const fr = { px: 300, py: 300, theta: 0, omega: 0, vx: 0, vy: 0, facing: 1 as const };
    const h = new HornBody(model, mat, fr);
    for (let i = 0; i < 1200; i++) h.step(1 / 240, fr);
    const v = h.tipVelocity();
    assert.ok(Math.hypot(v[0], v[1]) < 5, `${mat} not at rest: ${Math.hypot(v[0], v[1])}`);
  }
});

test('衝突が強いほどダメージが大きい／硬い材質は反作用ダメージが大きい', () => {
  const base = { flexSpeed: 0, localMass: 4, hornMass: 25, headHit: false, targetGuarding: false, targetCharging: false, attackerCracked: false, targetHardness: 0.3 };
  const slow = computeBodyHit({ ...base, attacker: MATERIALS.plastic, closingSpeed: 400, relSpeed: 400 });
  const fast = computeBodyHit({ ...base, attacker: MATERIALS.plastic, closingSpeed: 1200, relSpeed: 1200 });
  assert.ok(fast.damage > slow.damage);
  const none = computeBodyHit({ ...base, attacker: MATERIALS.plastic, closingSpeed: 60, relSpeed: 60 });
  assert.equal(none.damage, 0);
  const rec = MATERIAL_IDS.map((id) => computeBodyHit({ ...base, attacker: MATERIALS[id], closingSpeed: 1000, relSpeed: 1000 }).recoil);
  const r = Object.fromEntries(MATERIAL_IDS.map((id, i) => [id, rec[i]]));
  assert.ok(r.glass > r.plastic && r.azuki > r.plastic, JSON.stringify(r));
  assert.ok(r.rubber < r.cork && r.cork < r.plastic, JSON.stringify(r));
  // しなり速度が大きいほどゴムのしなり攻撃が乗る
  const w0 = computeBodyHit({ ...base, attacker: MATERIALS.rubber, closingSpeed: 900, relSpeed: 900, flexSpeed: 0 });
  const w1 = computeBodyHit({ ...base, attacker: MATERIALS.rubber, closingSpeed: 900, relSpeed: 900, flexSpeed: 1500 });
  assert.ok(w1.whip > w0.whip + 20);
});

function bestSwingRecoil(material: (typeof MATERIAL_IDS)[number]) {
  // CPU用のスイングプランで「当たる」間合いとチャージ量を選び、実際の物理で振る
  const probe = new Match({ polygon: poly('stub'), material }, { polygon: poly('stub'), material: 'plastic' });
  const plan = planSwing(probe.fighters[0], probe.fighters[1]);
  let best = { ci: 0, di: 0, s: 0 };
  plan.score.forEach((row, ci) => row.forEach((s, di) => s > best.s && (best = { ci, di, s })));
  const m = new Match({ polygon: poly('stub'), material }, { polygon: poly('stub'), material: 'plastic' }, { countdown: 0 });
  m.fighters[0].x = 400;
  m.fighters[1].x = 400 + plan.dists[best.di];
  m.setInput(0, { charge: true, move: 0 });
  for (let i = 0; i < Math.ceil((plan.charges[best.ci] * 0.9) / SIM_DT); i++) m.step();
  m.setInput(0, { charge: false, move: 0 });
  for (let i = 0; i < 120; i++) m.step();
  return { recoil: m.fighters[0].stats.recoilTaken, dealt: m.fighters[0].stats.dealt };
}

test('実際の試合で、硬い材質で強く当てると自分にも反作用ダメージ', () => {
  const glass = bestSwingRecoil('glass');
  const azuki = bestSwingRecoil('azuki');
  const rubber = bestSwingRecoil('rubber');
  assert.ok(glass.dealt > 0 && azuki.dealt > 0, JSON.stringify({ glass, azuki }));
  assert.ok(glass.recoil > 5 && azuki.recoil > 5, JSON.stringify({ glass, azuki }));
  assert.ok(glass.recoil > rubber.recoil, JSON.stringify({ glass, rubber }));
});

test('あずきのアイスは時間経過で実際に細く短くなり、最後は消える', () => {
  const m = new Match({ polygon: poly('spear'), material: 'azuki' }, { polygon: poly('stub'), material: 'plastic' }, { countdown: 0, timeLimit: 999 });
  m.fighters[0].x = 200;
  m.fighters[1].x = 1090;
  const h = m.fighters[0].horn;
  const L0 = h.length;
  const hp0 = m.fighters[0].maxHp;
  let maxW0 = 0;
  for (let i = 0; i < h.vertX.length; i++) maxW0 = Math.max(maxW0, Math.abs(h.model.bindings[i].d * h.widthScale));
  for (let i = 0; i < 40 / SIM_DT; i++) m.step();
  assert.ok(h.length < L0 * 0.75, `length ${h.length} vs ${L0}`);
  assert.ok(h.widthScale < 0.8);
  assert.ok(m.fighters[0].maxHp < hp0);
  for (let i = 0; i < 60 / SIM_DT && m.state === 'fight'; i++) m.step();
  assert.ok(h.destroyed || m.result?.reason === 'melt', 'melts away');
  assert.equal(m.result?.winner, 1);
});

test('ガラスは激しい試合でひび割れ・破損イベントが起きる', () => {
  const m = new Match({ polygon: poly('spear'), material: 'glass' }, { polygon: poly('club'), material: 'azuki' }, { countdown: 0 });
  let cracked = false;
  let broke = false;
  const brainA = new CpuBrain('hard', 1);
  const brainB = new CpuBrain('hard', 2);
  for (let i = 0; i < 90 / SIM_DT && m.state !== 'over'; i++) {
    m.setInput(0, brainA.update(m, 0, SIM_DT));
    m.setInput(1, brainB.update(m, 1, SIM_DT));
    m.update(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'crack' && e.f === 0) cracked = true;
      if (e.type === 'break' && e.f === 0) broke = true;
    }
    if (broke) break;
  }
  assert.ok(cracked || broke, 'glass should crack in a hard fight');
});

test('角が折れると形状が短くなり、当たり判定（輪郭・凸ピース）も更新される', () => {
  const fr = { px: 300, py: 300, theta: 0, omega: 0, vx: 0, vy: 0, facing: 1 as const };
  const h = new HornBody(buildHornModel(poly('spear')), 'glass', fr);
  const L0 = h.length;
  const v0 = h.version;
  const r = h.cut(L0 * 0.5, fr);
  assert.equal(r.destroyed, false);
  assert.ok(r.debris && r.debris.length >= 3, 'debris polygon');
  assert.ok(h.length < L0 * 0.7, `length ${h.length}`);
  assert.ok(h.version > v0);
  assert.equal(h.vertX.length, h.model.polygon.length);
  assert.ok(h.model.pieces.length > 0);
});

test('高速でもすり抜けない（細い角を高速で振っても接触を検出）', () => {
  // 先端速度が大きい状況でも、サブステップ数が速度に応じて増える
  const m = new Match({ polygon: poly('spear'), material: 'glass' }, { polygon: poly('stub'), material: 'plastic' }, { countdown: 0 });
  let contacts = 0;
  damageHooks.onBodyHit = () => contacts++;
  m.fighters[0].x = 400;
  m.fighters[1].x = 980;
  for (let i = 0; i < 20; i++) m.step();
  m.setInput(0, { charge: true, move: 0 });
  for (let i = 0; i < 110; i++) m.step();
  m.setInput(0, { charge: false, move: 0 });
  for (let i = 0; i < 120; i++) m.step();
  damageHooks.onBodyHit = undefined;
  assert.ok(contacts > 0);
});

test('CPU と1試合を最後まで（全材質・全難易度でクラッシュせず決着）', () => {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    for (const mat of MATERIAL_IDS) {
      const m = new Match({ polygon: poly('classic'), material: mat }, { polygon: poly(HORN_TEMPLATES[MATERIAL_IDS.indexOf(mat)].id), material: 'rubber' });
      const a = new CpuBrain(diff, 3);
      const b = new CpuBrain(diff, 4);
      let guard = 0;
      while (m.state !== 'over' && guard++ < 100 / SIM_DT) {
        m.setInput(0, a.update(m, 0, SIM_DT));
        m.setInput(1, b.update(m, 1, SIM_DT));
        m.update(SIM_DT);
        m.drainEvents();
        for (const f of m.fighters) for (let k = 0; k < f.horn.n; k++) assert.ok(Number.isFinite(f.horn.x[k]) && Number.isFinite(f.horn.y[k]));
      }
      assert.equal(m.state, 'over', `${diff} ${mat}`);
      assert.ok(m.result);
    }
  }
});

test('HPは形状補正に上限（巨大化だけで無敵にならない）', () => {
  const small = buildHornModel(poly('stub')).stats;
  const huge = buildHornModel(processOutline([[[0, 10], [390, -10], [390, -390], [-10, -390]]]).polygon).stats;
  for (const id of MATERIAL_IDS) {
    const hs = computeMaxHP(MATERIALS[id], small);
    const hh = computeMaxHP(MATERIALS[id], huge);
    assert.ok(hh <= MATERIALS[id].maxHP * 1.25 && hh >= hs);
  }
});

test('角JSON：検証と改ざん拒否', () => {
  const ok = validateHornData({ version: 1, name: '<b>x</b>', material: 'rubber', vertices: [[0, 0], [20, -40], [40, -100], [15, -120], [-10, -30]] });
  assert.ok(ok.ok);
  assert.ok(!ok.value!.name.includes('<'));
  assert.equal(validateHornData({ version: 1, name: 'x', material: 'rubber', vertices: [[0, 0], [1, 1]] }).ok, false);
  assert.equal(validateHornData({ version: 1, name: 'x', material: 'rubber', hardness: 99, vertices: [[0, 0], [20, -40], [40, -100]] }).ok, false);
  assert.equal(validateHornData({ version: 1, name: 'x', material: 'rubber', vertices: [[0, 0], [NaN, -40], [40, -100]] }).ok, false);
  assert.equal(validateHornData({ version: 1, name: 'x', material: 'rubber', vertices: Array.from({ length: 500 }, (_, i) => [i % 50, -i % 70]) }).ok, false);
});
