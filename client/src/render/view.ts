/**
 * 描画用ビュー（描画処理は物理計算から分離し、このデータだけを見る）
 * CPU戦では Match から、オンライン戦ではサーバーのスナップショット補間から作る。
 */
import { CrackMark, HornModel, Match, MatchState, MaterialId, Phase, PHASES } from '@kinggnu/shared';

export interface FighterView {
  idx: 0 | 1;
  facing: 1 | -1;
  name: string;
  material: MaterialId;
  x: number;
  vx: number;
  theta: number;
  phase: Phase;
  charge: number;
  hp: number;
  maxHp: number;
  baseMaxHp: number;
  guard: boolean;
  stun: number;
  flash: number;
  melt: number;
  widthScale: number;
  stress: number;
  crackLevel: number;
  destroyed: boolean;
  model: HornModel;
  nodesX: ArrayLike<number>;
  nodesY: ArrayLike<number>;
  cracks: CrackMark[];
  /** 炎で燃えている残り時間 */
  burn: number;
  /** 牛のスキン（見た目だけ） */
  skin?: string;
}

export interface MatchView {
  state: MatchState;
  countdown: number;
  time: number;
  timeLeft: number;
  timeScale: number;
  fighters: [FighterView, FighterView];
}

export function viewFromMatch(m: Match): MatchView {
  return {
    state: m.state,
    countdown: m.countdown,
    time: m.time,
    timeLeft: m.timeRemaining,
    timeScale: m.timeScale,
    fighters: m.fighters.map((f) => ({
      idx: f.idx,
      facing: f.facing,
      name: f.name,
      material: f.material,
      x: f.x,
      vx: f.vx,
      theta: f.theta,
      phase: f.phase,
      charge: f.charge,
      hp: f.hp,
      maxHp: f.maxHp,
      baseMaxHp: f.baseMaxHp,
      guard: f.guard,
      stun: f.stun,
      flash: f.hitFlash,
      melt: f.horn.melt,
      widthScale: f.horn.widthScale,
      stress: f.horn.stress,
      crackLevel: f.horn.crackLevel,
      destroyed: f.horn.destroyed,
      model: f.horn.model,
      nodesX: f.horn.x,
      nodesY: f.horn.y,
      cracks: f.horn.cracks,
      burn: f.burn,
    })) as unknown as [FighterView, FighterView],
  };
}

export function phaseFromCode(c: number): Phase {
  return PHASES[c] ?? 'idle';
}
