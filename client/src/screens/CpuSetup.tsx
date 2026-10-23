/** CPU戦の設定：難易度・CPUの材質と角プリセット */
import { useState } from 'react';
import { Difficulty, HORN_TEMPLATES, MATERIALS, MATERIAL_IDS, MaterialId, Poly, processOutline, templateStrokes } from '@kinggnu/shared';
import { HornPreview } from '../components/HornPreview';
import { sfx } from '../game/audio';

export interface CpuChoice {
  difficulty: Difficulty;
  material: MaterialId | 'random';
  template: string | 'random';
}

interface Props {
  initial: CpuChoice;
  onStart: (c: CpuChoice, resolved: { polygon: Poly; material: MaterialId; templateName: string }) => void;
  onBack: () => void;
}

export function resolveCpu(c: CpuChoice) {
  const material = c.material === 'random' ? MATERIAL_IDS[Math.floor(Math.random() * MATERIAL_IDS.length)] : c.material;
  const tpls = HORN_TEMPLATES;
  const tpl = c.template === 'random' ? tpls[Math.floor(Math.random() * tpls.length)] : tpls.find((t) => t.id === c.template) ?? tpls[0];
  const polygon = processOutline(templateStrokes(tpl.id)).polygon;
  return { polygon, material, templateName: tpl.name };
}

export function CpuSetup({ initial, onStart, onBack }: Props) {
  const [c, setC] = useState<CpuChoice>(initial);
  const previewTpl = c.template === 'random' ? null : processOutline(templateStrokes(c.template)).polygon;
  return (
    <div className="screen cpu-setup">
      <header className="bar">
        <button className="ghost" onClick={onBack}>
          ← 材質選択へ
        </button>
        <h2>CPU BATTLE</h2>
        <span />
      </header>
      <div className="setup-body panel">
        <h4>難易度</h4>
        <div className="seg">
          {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
            <button key={d} className={c.difficulty === d ? 'on' : ''} onClick={() => setC({ ...c, difficulty: d })}>
              {d.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="hint">
          {c.difficulty === 'easy' ? '攻撃タイミングが甘い' : c.difficulty === 'normal' ? '間合いを測って攻撃してくる' : '角の揺れや距離を読み、ガードも使う'}
        </p>
        <h4>CPUの材質</h4>
        <div className="seg wrap">
          <button className={c.material === 'random' ? 'on' : ''} onClick={() => setC({ ...c, material: 'random' })}>
            ランダム
          </button>
          {MATERIAL_IDS.map((m) => (
            <button key={m} className={c.material === m ? 'on' : ''} onClick={() => setC({ ...c, material: m })}>
              {MATERIALS[m].name}
            </button>
          ))}
        </div>
        <h4>CPUの角</h4>
        <div className="seg wrap">
          <button className={c.template === 'random' ? 'on' : ''} onClick={() => setC({ ...c, template: 'random' })}>
            ランダム
          </button>
          {HORN_TEMPLATES.map((t) => (
            <button key={t.id} className={c.template === t.id ? 'on' : ''} onClick={() => setC({ ...c, template: t.id })}>
              {t.name}
            </button>
          ))}
        </div>
        {previewTpl && <HornPreview polygon={previewTpl} material={c.material === 'random' ? 'plastic' : c.material} width={220} height={150} />}
        <button
          className="primary big"
          onClick={() => {
            sfx.click();
            onStart(c, resolveCpu(c));
          }}
        >
          FIGHT!
        </button>
      </div>
    </div>
  );
}
