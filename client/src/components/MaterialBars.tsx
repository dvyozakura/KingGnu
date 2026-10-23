/** 材質の比較バー（材質選択・図説で共通） */
import { MaterialId, materialBars } from '@kinggnu/shared';

function Bar({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="meter">
        <div style={{ width: `${Math.round(Math.max(0.03, Math.min(1, v)) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export function MaterialBars({ id, speed = true }: { id: MaterialId; speed?: boolean }) {
  const b = materialBars(id);
  return (
    <>
      <Bar label="硬度" v={b.hardness} color="#f2c14e" />
      <Bar label="しなり" v={b.flex} color="#5bd66b" />
      <Bar label="HP" v={b.hp} color="#ef5350" />
      <Bar label="反作用" v={b.recoil} color="#b388ff" />
      {speed && <Bar label="速さ" v={b.speed} color="#5aa9ff" />}
    </>
  );
}

/** カードに付けるバッジ */
export function materialBadge(id: MaterialId): string | null {
  if (id === 'azuki') return 'BOSS';
  if (id === 'iron') return 'HEAVY';
  if (id === 'fire' || id === 'gold' || id === 'coral') return 'NEW';
  return null;
}
